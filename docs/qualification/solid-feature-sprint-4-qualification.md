# Solid Feature Sprint 4 Qualification Ledger

- Candidate: `solid-feature-sprint-4`, revision 1
- Scope: planar-face-supported Blind New Body Extrude plus same-body/producer/component explicit face repair
- Current decision: **QUALIFIED**
- Completion gates: **ALL CLOSED — NO REQUIRED WORK REMAINS FOR THE BOUNDED SCOPE**
- Frozen manifest: `contracts/solid-feature-candidate/sprint-4.json`
- Source specification: `docs/specs/solid-feature-modernization-sprint-4.md`
- Qualified prerequisite: Sprint 3 revision 2 at `artifacts/solid-feature-qualification/runs/20260828T135258Z-solid-feature-sprint-3-r2`
- Immutable automated-pass run: `artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`

This ledger is append-only. Planning decisions, failed probes, findings,
remediation, focused checks, automated attempts, independent review, and
deferrals remain visible. No planned fixture, command, artifact, or reserved
runtime path is evidence of implemented behavior.

## Current gate state

| Gate | State | Exact evidence |
|---|---|---|
| Scope and acceptance | Qualified | Attempt 40 completed the entire frozen no-waiver gate against the post-remediation source, and Attempt 41 returned exact standalone `ZERO FINDINGS`. |
| Candidate structure | Passed | Revision 1 is `qualification_ready`; current candidate manifest SHA-256 is `4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`. |
| Conditional native authority | Passed | Current accepted native B-rep authority, exact oriented planar frames, generated release-WASM execution, negative authority, and parity records passed. |
| Durable document/runtime | Automated pass | Canonical string persistence passes across document 11/11, storage 19/19, crawler-sketch, feature-kernel, app builder, runtime, WASM/native evidence, alpha evidence, and corrected history typing in the source-bound gate. |
| Native/release-WASM geometry | Automated pass | Attempt 40 exported ten native and ten generated release-WASM fixtures and passed 10/10 zero-difference parity. |
| Production worker/browser | Automated pass | Attempt 40 production generated-worker JUnit passed 2/2 with zero failures/errors/skips and retained eight unobscured screenshots. |
| Explicit repair | Passed | Read-only deterministic candidate collection, actual recovered-geometry preview, cancel, one-transaction same-owner repair, undo/redo, and reopen passed. |
| Performance | Automated pass | Both locked workloads completed 2 warmups, 10 measured iterations, and 50 cancellation cycles with zero budget violations and zero Long Tasks; exact Attempt 40 observations are recorded below. |
| Runtime lock | Passed | Build `solid-feature-sprint-4-r1-20260828`; release-WASM SHA-256 `0e1f3cb3b3c1605df02ee34e87546563ee199a3678bb7d7b6b3c810cf5e9cd89`, 10,893,016 bytes. |
| Full automated qualification | Passed | Attempt 40 passed 28/28 commands and sealed 35 qualification records plus a 163-entry checksum ledger; isolated-bundle validation passed. |
| Independent review | Passed | Attempt 41's fresh exact-state review returned exact standalone `ZERO FINDINGS`; after final reconciliation, the same reviewer completed Attempt 42's documentation-only re-review of all four completion documents plus `git diff --check` and again returned exact standalone `ZERO FINDINGS`. |

## Story evidence state

| Story | Final state | Exact evidence |
|---|---|---|
| E3D-S4-01 | Automated passed; findings closed | Attempt 34 closed all persisted-ID paths; Attempt 38 closed the evidence sentinel mismatch; Attempt 40 passes the complete source-bound gate and 10/10 parity. |
| E3D-S4-02 | Automated passed; finding closed | Exact nanometer local/world inverse transforms execute for top, bottom, and orthogonal side faces with native/WASM parity. |
| E3D-S4-03 | Automated passed; findings closed | Planar circle/annulus-with-hole execution and independent AABB, centroid, volume, surface-area, classification, body-count, and canonical-hash oracles pass. |
| E3D-S4-04 | Automated passed; findings closed | Body, producer, and component mismatch variants execute; production JUnit is 2/2 and eight screenshots are unobscured. |
| E3D-S4-05 | Qualified; all gates closed | Attempt 40 supplies the complete immutable no-waiver bundle; Attempt 41 returned exact standalone `ZERO FINDINGS`; Attempt 42's final documentation-only re-review also returned exact standalone `ZERO FINDINGS`. |

## Frozen included boundary

- current analytic planar face on an accepted body produced by the qualified
  Extrude path;
- same component for support, sketch, feature, and body;
- durable topology face identity plus current native runtime authority;
- exact deterministic origin, X/Y axes, normal, handedness, and unit scale;
- qualified line/arc/circle regions with qualified holes;
- Blind, New Body, and Forward/Reverse/Symmetric only;
- upstream dimension edit that preserves the referenced face identity;
- preview/cancel/commit/edit/suppress/undo/redo/save/reopen/recompute;
- structured missing/stale/nonplanar/suppressed/wrong-authority failures;
- deterministic repair-candidate ranking with no automatic application;
- explicit compatible planar-face repair on the same body, producer, and
  component, with real repair preview and one atomic transaction;
- native and generated release-WASM oracles/parity;
- production generated-worker browser lifecycle; and
- locked normal-lifecycle and repair performance workloads.

## Frozen excluded boundary

- arbitrary, angled, tangent, three-point, and face-derived datum planes;
- curved or nonanalytic sketch supports;
- automatic topology healing, split/merge naming, or topology-changing rebind;
- cross-component, cross-support, or general support rebinding outside the
  same-body/producer/component planar-face repair boundary;
- two-side, start, or target extents;
- Join, Cut, Intersect, Boolean targets, and participant selection;
- model-space handles, draft/taper, and thin Extrude; and
- Revolve, Sweep, and Loft.

These exclusions and deferrals remain unqualified even if adjacent
infrastructure exists.

## Conditional native-authority gate

The gate produced current native and generated release-WASM observations, not
descriptor assertions, for every required subject:

| Subject | State and observation |
|---|---|
| Authority identity | Passed — accepted document revision, body, producer feature, component, face kind, stable token, and stable kernel identity agree. |
| Analytic planarity | Passed — runtime classifies each accepted current face as planar without polygon fallback. |
| Exact frame | Passed — origin, orthonormal X/Y axes, normal, handedness, scale, and polarity are deterministic. |
| Transform | Passed — exact local/world fixtures cover top, bottom, and orthogonal side faces. |
| Upstream edit | Passed — topology-preserving dimension edit retains identity and produces the contracted frame/result update. |
| Negative authority | Passed — missing, stale, wrong-body, wrong-producer, wrong-component, nonplanar, and suppressed cases fail closed and preserve accepted state. |
| Runtime equivalence | Passed — native and generated release WASM agree on normalized values and diagnostic categories. |

Renderer packet centroid/normal data, fallback signatures, stable tokens alone,
and sampled polygons did not authorize the frame.

## Required fixture ledger

| Fixture | Parity | Final state and immutable evidence |
|---|---:|---|
| `extrude-planar-face-orientation-matrix` | Yes | Automated pass — native/release-WASM files and `records/fixture.extrude-planar-face-orientation-matrix.json` |
| `extrude-planar-face-upstream-edit` | Yes | Automated pass — native/release-WASM files and `records/fixture.extrude-planar-face-upstream-edit.json` |
| `extrude-planar-face-save-reopen-edit` | Yes | Automated pass — native/release-WASM files and `records/fixture.extrude-planar-face-save-reopen-edit.json` |
| `planar-face-missing-reference` | Yes | Automated pass — native/release-WASM files and `records/fixture.planar-face-missing-reference.json` |
| `planar-face-stale-current-evidence` | Yes | Automated pass — native/release-WASM files and `records/fixture.planar-face-stale-current-evidence.json` |
| `planar-face-nonplanar-reference` | Yes | Automated pass — native/release-WASM files and `records/fixture.planar-face-nonplanar-reference.json` |
| `planar-face-suppressed-producer` | Yes | Automated pass — native/release-WASM files and `records/fixture.planar-face-suppressed-producer.json` |
| `planar-face-wrong-body-producer-component` | Yes | Automated pass — native/release-WASM files and `records/fixture.planar-face-wrong-body-producer-component.json` |
| `planar-face-broken-support-explicit-repair` | Yes | Automated pass — native/release-WASM files and `records/fixture.planar-face-broken-support-explicit-repair.json` |
| `planar-face-ambiguous-repair-refused` | Yes | Automated pass — native/release-WASM files and `records/fixture.planar-face-ambiguous-repair-refused.json` |
| `production-planar-face-lifecycle` | No | Automated pass — `fixtures/production-planar-face-lifecycle.json`, browser JUnit, eight screenshots, and its fixture record |

Each lifecycle token in the records is bound to an executed operation or an
observed declared rejection. No descriptor-shaped substitute is accepted.

## Required test and artifact ledger

| Test | Kind | Final state and immutable evidence |
|---|---|---|
| `candidate-manifest-validation` | Schema | Passed — candidate/schema positive and negative validation plus its test record |
| `planar-face-document-authority-contracts` | Native | Passed — focused and workspace tests plus its test record |
| `native-planar-face-extrude` | Native | Passed — ten native fixture results plus its test record |
| `wasm-planar-face-extrude` | WASM | Passed — ten generated release-WASM fixture results plus its test record |
| `planar-face-command-state` | Unit | Passed — application suite 240/240 plus its test record |
| `planar-face-native-wasm-parity` | Parity | Passed — 10/10 fixture comparisons, zero differences, one JUnit testsuite containing ten passing testcases, JSON and test record |
| `production-planar-face-lifecycle` | Browser | Passed — 2/2 JUnit, eight screenshots, production fixture and test record |
| `planar-face-performance-regression` | Performance | Passed — both locked workloads, zero violations and test record |
| `candidate-evidence-completeness` | Schema/evidence | Passed — completeness preflight, final validation, checksums, and test record |

The full gate also runs the separately provenance-bound `storage-mirror`
command; its 19/19 protocol tests passed in the final run, alongside the 11/11
document mirror and 240/240 application unit suite.

Required artifacts all passed: eleven fixture descriptors; locked release
runtime WASM; production build; native/release-WASM fixtures; parity JSON/JUnit;
browser fixture/JUnit/screenshots; performance JSON; qualification report; 35
qualification records; and 163-entry checksum/index validation. Runtime build ID
is `solid-feature-sprint-4-r1-20260828`; release-WASM SHA-256 is
`0e1f3cb3b3c1605df02ee34e87546563ee199a3678bb7d7b6b3c810cf5e9cd89`
(10,893,016 bytes);
feature-kernel SHA-256 is
`c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`;
operation-catalog SHA-256 is
`ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`.

## Performance boundary

Both workloads passed their locked budgets in the production browser with zero
violations:

| Workload | Runs | Preview p50 / p95 | Recompute p50 / p95 | Cancel max | Long Tasks | Heap growth | Additional observation |
|---|---:|---:|---:|---:|---:|---:|---|
| `extrude-planar-face-rectangle` | 2 warmup / 10 measured / 50 cancel | 48.200000047683716 / 54.700000047683716 ms | 18 / 21.1 ms | 51.89999985694885 ms | 0 | +1,363,204 bytes | 0 violations |
| `planar-face-support-repair` | 2 warmup / 10 measured / 50 cancel | 63.299999952316284 / 118.90000009536743 ms | 128.5 / 231.70000004768372 ms | 42.700000047683716 ms | 0 | +866,640 bytes | candidate count 1; 62 ranking observations; 0 violations |

Sprint 1–3 regression thresholds were not weakened.

## Automated-pass identity and environment

The post-Attempt-38 immutable run is
`artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`.
It binds:

- candidate manifest SHA-256
  `4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`;
- Git commit `3f2ec88b4687c15cd8721f840ed21b293955f95e`;
- source-snapshot content SHA-256
  `f4f01a45db55c2626a36c7a161db6da788e62b650cbc73efb1035ca0d87a76f6`;
- source algorithm `sha256-git-visible-path-content-v1`, 870 entries/files,
  zero deleted paths, excluding `artifacts/solid-feature-qualification/**`;
- 28/28 passing commands, 35 records, and 163 checksum entries covering every
  immutable-run file other than `SHA256SUMS.json`; and
- ten native fixture files, ten release-WASM fixture files, eight unobscured
  screenshots, 2/2 passing browser tests, 10/10 passing parity fixture
  comparisons, and one parity JUnit testsuite containing ten passing testcases.

Toolchain: Rust/Cargo 1.94.0, Node 22.23.1, pnpm 11.19.0, and PowerShell
7.6.4. Environment: Windows 10.0.22621 x64, 8 logical CPUs,
68,550,533,120 bytes of memory, and Chrome 151.0.7922.109 headless at 1440×900,
device-pixel ratio 1, one worker, port 4186.

The exact structured rerun recorded by `run-metadata.json` is:

```powershell
pwsh -NoProfile -File scripts/qualify-solid-features.ps1 -Manifest contracts/solid-feature-candidate/sprint-4.json -NativeEvidenceCommand 'cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/native' -WasmEvidenceCommand 'node scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/release-wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm'
```

## Append-only attempt ledger

### 2026-08-28 — Attempt 0: approved planning freeze

**Objective:** freeze the smallest dependency-correct post-Sprint 3 slice before
implementation begins.

**Observations:**

- Sprint 1 qualified origin-plane Extrude and Sprint 3 qualified offset-plane
  Extrude. Initiative Gate B still lacks its planar-face workflow.
- Durable topology references, face selection, current packet-qualified planar-
  face observations, deterministic recompute, and candidate ranking helpers
  exist, but they are not a qualified Exact Extrude path.
- Exact Extrude runtime conversion and frame resolution currently reject
  topology-backed sketch support.
- A renderer-derived frame would bypass the native-authority and parity product
  boundary and is therefore rejected as an implementation strategy.

**Decision:** freeze planar-face Blind New Body Extrude plus explicit compatible
repair on the same body, producer, and component. Make implementation
conditional on the native-authority gate. Do not pull forward Cut, generalized
rebinding, topology healing, or advanced extents.

**Completion state:** planning documents and a pending-artifacts manifest are
created. Fixture descriptors, locked workload budgets, implementation, tests,
generated artifacts, runtime lock, automated evidence, and independent review
remain pending. Current decision remains **NOT QUALIFICATION-READY**.

Future attempts append below this entry. No failed attempt or finding is removed
when remediation occurs.

### 2026-08-28 — Attempt 1: conditional native-authority gate

**Objective:** prove that a current accepted B-rep, rather than renderer or
fallback data, can authorize an exact planar-face frame in native and generated
release WASM before broader Sprint 4 implementation begins.

**Initial implementation:** the runtime decoded the accepted body snapshot,
looked up a body-qualified canonical decimal-`u64` face identity, required an
analytic plane, used the oriented surface normal, chose a deterministic
least-aligned-principal X axis and right-handed Y axis, and chose the
lexicographically first current B-rep boundary vertex as the exact nanometer
origin. Structured missing, nonplanar, degenerate, invalid-ID, and unsafe-frame
diagnostics were added with a `planarFaceFrameJson` WASM binding.

**Review findings:**

1. The first implementation accepted the latest unsuppressed snapshot even
   when its producer was dirty or failed, so stale topology could appear current.
2. A query-only scan treated the same body-local stable ID on another body as
   proof of wrong ownership, although body-local ID collisions are valid.
3. The checked-in generated release WASM did not yet contain or execute the new
   authority binding.

**Remediation:** current authority now requires an unsuppressed producer whose
recompute state is `clean` at the document's accepted revision; dirty and failed
producers return structured `stale_body`. Query-only face misses remain
body-qualified `missing_face` and no longer infer ownership from another body's
local ID. Wrong body/producer/component validation remains the responsibility
of the durable topology-reference wrapper. The part runtime was regenerated,
and a repeatable release-WASM probe was added at
`scripts/test-planar-face-frame-wasm.mjs`.

**Executed verification:** focused authority tests passed 4/4; the full part-
runtime unit suite passed 63/63; legacy runtime integration passed 3/3; a
`wasm32` check and deterministic release-runtime generation passed; and
`node scripts/test-planar-face-frame-wasm.mjs` returned a current planar cap
with body `body:part`, face `26`, accepted revision `1`, origin
`[0,0,10000000]`, normal `[0,0,1000000]`, and right-handed orientation. The
generated WASM was 10,767,137 bytes with SHA-256
`caa067b25c5b14d66f389545b81a7d2eaa7755b2f30251b6886ab8cfe2072175`.
An independent scoped re-review reported no remaining gate issues.

**Decision:** the conditional native-authority gate is **PASSED**. This is not a
Sprint 4 qualification claim. Durable topology-face support, Extrude execution,
upstream recompute, explicit repair, fixture oracles, production browser,
performance, the source-bound automated bundle, and final independent review
remain pending. The legacy validation reference `topology:extrude-top` stores
face ID `6`, while the current rebuilt cap is `26`; it must enter explicit repair
or be reconciled by current authority and must never be authorized by fallback
geometry.

### 2026-08-28 — Attempt 2: descriptor and workload contract registration

**Objective:** close candidate-structure blockers without representing planned
contracts as execution evidence.

**Changes:** all eleven frozen Sprint 4 fixture descriptors were added under
`contracts/solid-feature-candidate/fixtures`. The descriptors name exact
authority, geometry, identity, failure-atomicity, lifecycle, repair, and
production-worker observations; the production fixture remains explicitly
non-parity. Locked budget rows were added for
`extrude-planar-face-rectangle` and `planar-face-support-repair` without
changing any Sprint 1–3 threshold.

**Executed verification:** every descriptor parses as JSON, validates against
`fixture.schema.json`, closes its manifest story/test references, and
`pwsh -NoProfile -File scripts/test-solid-feature-candidate.ps1 -Manifest
contracts/solid-feature-candidate/sprint-4.json` passes.

**Decision:** the candidate is structurally valid but remains
`scope_frozen_artifacts_pending` and **NOT QUALIFICATION-READY**. Descriptors
and budgets are contracts only. Core execution, UI lifecycle, exporters,
actual native/WASM observations, browser evidence, performance measurements,
runtime locks, and final evidence remain pending.

### 2026-08-28 — Attempt 3: durable topology support and explicit-repair core

**Objective:** implement the native durable/runtime boundary behind the frozen
face-supported Extrude and repair stories before generating candidate evidence.

**Implementation:** `PlanarSupportReferenceV2` now persists topology-face
support and participates in immutable, mutable, and owned reference traversal.
The part runtime resolves topology-backed sketch and Extrude frames exclusively
from the current accepted native B-rep, builds producer-to-sketch-to-Extrude
dependencies, and uses pending upstream snapshots during ordered recompute.
History repair is restricted to an explicitly selected face on the same body,
producer, and component. One transaction updates the retained topology
reference, sketch feature input, owned sketch support, downstream V2 support,
downstream direct support input, dirty closure, and recomputed descendant body
result. Candidate inspection remains read-only; fallback signatures participate
only in ranking and never authorize geometry or automatic application.

**Implementation findings and remediation:** self-review found that the first
rebind draft did not rewrite downstream V2 support, that a fallback signature
could be mistaken for frame authority, and that recompute read accepted instead
of pending upstream snapshots. Those paths were corrected. A production-browser
probe then found that face authority required a producer's
`evaluated_revision` to equal the document revision, so an unrelated accepted
sketch transaction made an unchanged clean base body appear stale. Freshness now
requires the document recompute snapshot to match the accepted revision and the
producer state to be `clean`; the producer's older evaluation revision is valid
when no dependency change made it dirty. Dirty and failed producers still fail
closed. The new repair end-to-end test then found that rebind rewrote the V2
support but left the downstream Extrude's direct `inputs.support` stale; that
input is now updated in the same atomic change.

**Executed verification:** focused topology runtime tests passed 2/2. The part-
runtime suite passed 65/65 unit tests and 3/3 legacy integration tests; history
passed 12/12. The repair test proves read-only ranking, wrong-kind and cross-
owner refusal with unchanged hash/history, explicit same-owner native-planar
selection, a single transaction containing `RebindTopology` plus downstream
`AcceptFeatureResult`, stable feature/body/sketch/profile identities, exact
recomputed bounds, undo/redo, save/reopen, and equal recompute snapshots.
Runtime/history format checks and the scoped diff check passed.

**Decision:** the durable/runtime/repair core is implemented with no known open
core defect. This is not qualification evidence. Executable native/release-WASM
fixture adapters, production lifecycle and performance results, a final runtime
lock, the full immutable gate, and independent exact-state review remain
pending.

### 2026-08-28 — Attempt 4: interim independent core audit

**Objective:** audit the implemented core before allowing browser or fixture
work to become qualifying evidence.

**Independent findings:** the read-only reviewer reported seven actionable
issues, so Attempt 3's no-known-core-defect observation does not advance the
candidate. Two critical findings were that the generic repair layer considered
a retained stable token sufficient even when the stable kernel ID used by
execution changed, and that an incomplete caller-observed candidate list could
manufacture a repair state even while native authority still resolved the
stored face. Additional findings were a global V2 support rewrite outside the
selected branch, failure to rebind embedded body snapshots between successive
repair recomputations, missing native validation when accepting a new topology-
supported sketch, a face-only regression in the shared edge/vertex repair
ranker, and the absence of a separate read-only recovered-geometry preview and
cancel boundary before commit.

**Coverage findings:** the reviewer also required explicit tests for same-token
new-kernel-ID breakage, partial/stale observations, two independent branches,
second-hop fresh-snapshot consumption, invalid new support acceptance, generic
edge/vertex ranking, stale repair-preview basis, broken-state last-good packet
and history preservation, ambiguity/no candidate, suppression, all three
directions, and durable support/recompute-state alignment.

**Decision:** all seven findings are accepted as blockers. Core, browser,
performance, and evidence adapters are being revised together. No artifact from
the pre-remediation browser or exporter probes is eligible for Sprint 4
qualification. This attempt remains **NOT QUALIFICATION-READY**.

### 2026-08-28 — Attempt 5: executable-evidence integrity corrections

**Objective:** require fixture records to originate in executed native or
release-WASM behavior instead of descriptor-shaped exporter assertions.

**Findings:** harness review rejected an early negative adapter that recognized
loose error substrings and then copied category, code, field, and referenced IDs
from each descriptor. The nonplanar draft was especially invalid because it
rewrote a `missing_face` string into `nonplanar_face`. The suppressed-producer
draft did not observe a support refusal and instead recorded an unrelated
missing-feature recompute. Generic missing-feature and empty-inspection probes
also stamped lifecycle steps that they had not exercised. None of those drafts
is accepted as evidence.

**Remediation in progress:** native execution now uses a real accepted Revolve
curved face for nonplanarity and the core is adding a native/WASM structured,
read-only durable support diagnostic so exporters do not parse `EngineError`
text. The observed missing-reference oracle was corrected to
`missing_topology_face_support` at `extrude.support`; the observed stale-body
category was corrected to `stale_reference`. Remaining suppressed, wrong-owner,
and ambiguity descriptor oracles will be corrected only from the final
structured runtime DTO.

**Contract corrections:** the broken-support and suppressed-producer fixture
lifecycle lists contained duplicate `repair` or `recompute` tokens, although
runtime evidence is a unique executed-step set. Those descriptors now list each
required step once, and the validator is being hardened to reject duplicates.
The absent-reference fixture previously named recompute and repair after a load
state that the document validator correctly refuses; its executable boundary is
now preview, commit, and load. Retained-but-broken face recompute and repair
remain required in the dedicated broken-support and ambiguous-repair fixtures.

**Decision:** the harness remains fail-closed and the candidate remains **NOT
QUALIFICATION-READY** until every adapter emits exact structured observations,
all declared lifecycle steps execute, and native/release-WASM parity passes.

### 2026-08-28 — Attempt 6: independent core findings closure

**Objective:** remediate every blocker from Attempt 4 and make the durable
runtime and repair boundary independently testable.

**Remediation:** current authority now requires both the stable token and stable
kernel ID. Candidate inspection is read-only and derives its repair state from
current native authority rather than a caller-supplied partial observation set.
Rebind is branch-scoped and recursively updates embedded downstream support and
body snapshots. New and changed topology supports are validated through native
authority. Suppression and stale-state behavior preserves accepted state. Base
edits perform transitive atomic recompute, and render-packet topology mapping and
normal polarity were corrected. Repair preview has a separate exact basis,
evaluates the recovered frame and downstream result, is cancellable, and apply
is one atomic transaction.

**Executed verification:** the part-runtime unit suite passed 73/73 and legacy
runtime integration passed 3/3. WASM checks, zero-warning Clippy, formatting,
and scoped diff checks passed. Coverage includes same-token/new-kernel breakage,
partial/stale observations, independent branches, second-hop fresh-snapshot
consumption, invalid support acceptance, edge/vertex ranking regression,
stale-preview basis, last-good preservation, ambiguity/no candidate,
suppression, all three direction modes, and durable-state alignment.

**Decision:** all seven Attempt 4 core findings are closed. No pre-remediation
evidence is promoted; candidate qualification still depends on executable
harness, browser/performance, completeness, isolated bundle, and final review.

### 2026-08-28 — Attempt 7: executable native/WASM harness closure

**Objective:** replace every descriptor-shaped adapter rejected in Attempt 5
with exact executed native and generated release-WASM observations.

**Implementation:** native and WASM adapters now execute the ten parity fixtures
through structured runtime DTOs. Validators require exact lifecycle, geometry,
identity, atomicity, diagnostic, repair, and orientation oracles. Comparator and
non-parity negative self-tests remain fail-closed. The native harness includes
a dedicated repeatable matrix and repair suite.

**Executed verification:** native fixture adapters passed 10/10, generated
release-WASM adapters passed 10/10, fixture validators passed 10/10, parity
passed 10/10 fixture comparisons, and the native harness passed 11/11. Harness
repeatability, zero-warning Clippy, and candidate validation passed.

**Decision:** the executable evidence boundary is closed with structured
observations. Browser lifecycle, performance, final locks, and the complete gate
remain pending.

### 2026-08-28 — Attempt 8: production browser and performance closure

**Objective:** prove the bounded workflow through the production build,
generated worker, real release WASM, browser interaction, and locked workload
budgets.

**Implementation:** packet-equivalence caching avoids redundant GPU installs
without bypassing worker results. The Playwright harness starts and stops Vite
programmatically and exercises selection-first/tool-first creation, edit,
recompute, suppression, undo/redo, broken last-good state, repair preview/cancel,
explicit repair, reopen, and both performance workloads.

**Executed verification:** the application unit suite passed 237/237, production
build passed, and Playwright passed 2/2 with zero failures, errors, or skips and
eight screenshots. The generated release WASM was 10,883,999 bytes with SHA-256
`8d7f59032de3f8c8bc5f8862f1df4e58ae20b4ab1f9f703ed5b3e6cd18c4b04b`.
Both locked workloads completed 2 warmups, 10 measured iterations, and 50
cancellation cycles with zero violations and zero Long Tasks; exact measurements
remain recorded in the Performance boundary above and in `performance/results.json`.

**Decision:** production browser and quantitative performance evidence are
complete. They are not independently sufficient without source binding,
completeness, checksums, and isolated bundle validation.

### 2026-08-28 — Attempt 9: qualification environment memory discovery

**Objective:** run the source-bound qualification orchestrator unchanged in the
managed Windows environment.

**Failure:** the first full attempt could not query physical memory through CIM
because the environment denied that provider. The failure occurred before a
qualified bundle could be sealed.

**Remediation:** the orchestrator now falls back to Win32
`GlobalMemoryStatusEx` when CIM is unavailable. This preserves the actual
memory assertion rather than substituting a constant or weakening the
qualification environment contract.

**Verification:** the fallback reported 68,550,533,120 bytes and passed the
unchanged environment minimum. The failed attempt remains non-qualifying.

### 2026-08-28 — Attempt 10: source-snapshot temporary-output discovery

**Objective:** prove that source binding is limited to Git-visible source and is
repeatable in a dirty worktree.

**Failure:** a later full attempt found temporary Cargo target material exposed
through a workspace-local link-like path, so the source-snapshot self-test
correctly rejected unstable tool output.

**Remediation:** the temporary target material was moved reversibly under the
ignored `target` quarantine. No tracked or user-authored source was deleted or
rewritten.

**Verification:** the snapshot self-test passed and the final algorithm bound
853 Git-visible entries/files with zero deleted paths while excluding
`artifacts/solid-feature-qualification/**`.

### 2026-08-28 — Attempt 11: Node and pnpm environment recovery

**Objective:** execute the exact locked application, build, and browser commands
with Node 22 and pnpm 11 despite unavailable global shims.

**Failure:** the managed Volta pnpm shim was inaccessible, and pnpm-store
reconciliation left the ignored application installation without its expected
CLI blob. No fake version output was accepted.

**Remediation:** Node 22.23.1 and pnpm 11.19.0 were recovered into ignored
qualification-tool adapters from the local offline installation. A scoped
`web/crawler-app/pnpm-workspace.yaml` records the application package and its
existing patch configuration, isolating the application from the unrelated
parent package manager. Qualification metadata now invokes the real
`pnpm --dir web/crawler-app --version` command.

**Verification:** the exact unit command passed 237/237, production build
passed, Playwright 1.62.1 passed 2/2, and final metadata records Node 22.23.1 and
pnpm 11.19.0. The environment-only recovery creates no product deferral.

### 2026-08-29 — Attempt 12: qualification record-index correctness

**Objective:** seal complete candidate-scoped records without admitting global
or descriptor-only observations.

**Failures:** the first index pass incorrectly required every global performance
workload instead of the two exact candidate workload IDs. After that was fixed,
the non-parity `production-planar-face-lifecycle` fixture lacked an explicit
record mapping and assertion contract. Both failures prevented bundle sealing.

**Remediation:** record generation now projects and uniqueness-checks the exact
`candidate.performance_workload_ids` against the locked budget profile and
emits only that candidate subset. The production non-parity fixture has a strict
record mapping and executed lifecycle assertions.

**Verification:** the record writer produced all 34 pre-report records, the
candidate-scoped performance subset passed, and the production record passed
its lifecycle checks. Failed intermediate indexes remain non-qualifying.

### 2026-08-29 — Attempt 13: nested evidence and final-candidate validation

**Objective:** make completeness validation accept the canonical nested
orientation oracle while retaining strict schema rejection and exact final
fixture identity checks.

**Failures:** `evidence.schema.json` initially rejected the nested orientation
matrix oracle. The first schema correction temporarily dropped array-of-object
oracle support. The candidate validator also expected obsolete flat fixture
fields and a stale source identifier. Each issue was caught before sealing.

**Remediation:** the schema now admits canonical snake_case nested oracle
objects and arrays while still rejecting unknown keys such as `BadKey`; the
array-of-object branch was restored. The candidate validator now checks the
current fixture source path, result/lifecycle/direction/repair fields, and exact
worker URL.

**Executed verification:** manifest validation tests passed their nested-matrix
positive, array-of-object positive, and `BadKey` negative cases. The 34-record
writer, completeness preflight, simulated qualification-ready validation, and
isolated final-bundle validation all passed before the complete rerun.

**Decision:** schema and completeness blockers are closed without weakening
negative validation.

### 2026-08-29 — Attempt 14: immutable automated qualification pass

**Objective:** execute the complete no-waiver source-bound gate from candidate
validation through isolated sealed-bundle validation.

**Executed gate:** all 25 required commands passed: candidate contracts,
source-snapshot self-test, dependency pins, native workspace, native lint, five
WASM workspace checks, document mirror, operation mirror, two deterministic
generation passes, application unit, worker spike, parity and non-parity
self-tests, application build, native evidence, WASM evidence, native/WASM
parity, production browser, qualification index, and bundle integrity.

**Immutable result:**

- run: `artifacts/solid-feature-qualification/runs/20260829T052403Z-solid-feature-sprint-4-r1`;
- report: passed;
- build: `solid-feature-sprint-4-r1-20260828`;
- manifest SHA-256: `ecd6510e8569a35053bd5b9f410714aa637a4e6201325bb2bc3d68fdff37a99c`;
- commit: `3f2ec88b4687c15cd8721f840ed21b293955f95e`;
- source content SHA-256: `0362eb903651f4bc53c34981275ba319064e2c69d97e40dfa037ad5abfba99a1` under `sha256-git-visible-path-content-v1`, 853 entries/files, zero deleted;
- release-WASM SHA-256: `8d7f59032de3f8c8bc5f8862f1df4e58ae20b4ab1f9f703ed5b3e6cd18c4b04b`, 10,883,999 bytes;
- feature-kernel SHA-256: `c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`;
- operation-catalog SHA-256: `ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`;
- 35 records and 160 checksummed files after isolated sealed-bundle validation;
- ten native and ten release-WASM fixture files, eight screenshots, browser JUnit 2/2, 10/10 passing parity fixture comparisons, and one passing aggregate parity JUnit test; and
- zero performance-budget violations.

**Decision:** the automated Sprint 4 gate is **PASSED WITHOUT WAIVERS**. This is
not yet the final qualified decision: the mandatory independent exact-state
review is pending and must return `ZERO FINDINGS`. All frozen exclusions remain
explicitly deferred and unqualified.

### 2026-08-29 — Attempt 15: independent exact-state review rejected the initial bundle

**Objective:** independently audit the exact implementation, frozen acceptance
contracts, tests, repeatable harnesses, quantitative and qualitative behavior,
sealed evidence, and completion documentation rather than accepting the
mechanical gate result at face value.

**Verified mechanical evidence:** the reviewer independently validated the
35-record, 160-checksummed-file bundle, all 25 passing command outcomes, 10/10
native/release-WASM parity results, 2/2 browser JUnit tests, eight screenshots,
runtime/manifest identities, and locked performance values. The only post-seal
source differences were the four append-only completion/planning documents.

**Findings:** the reviewer rejected completion with eight P1 findings and one P2
finding:

1. the frozen planar-face path lacked an executed circle/annulus-with-hole case;
2. exact nanometer local-to-world-to-local round trips were not executed for the
   top, bottom, and orthogonal side frames;
3. the persisted topology reference did not itself carry its schema version and
   component ownership;
4. the wrong-body/producer/component fixture declared a mismatch matrix but its
   parity exporter mutated only the producer;
5. AABB, centroid, surface area, analytic classifications, body count, and
   canonical document hash were observed and parity-compared but were not all
   frozen as independent expected fixture oracles;
6. the gate accepted arbitrary native/WASM evidence command strings without
   preserving structured executable/argument provenance in the sealed command
   ledger or metadata;
7. candidate native/WASM test identities did not truthfully map to the commands
   and logs that executed the planar-face evidence;
8. accepted, broken-state, and reopened qualitative screenshots retained the
   Quick Tour overlay; and
9. the Sprint 4 rationale retained stale present-tense preimplementation
   language after the automated pass.

**Decision:** the initial immutable run remains retained historical evidence but
is **REJECTED FOR FINAL QUALIFICATION**. No waiver is permitted. Remediation must
close all nine findings, produce a fresh complete source-bound automated run and
isolated bundle, reconcile the append-only documents, and receive a fresh exact
`ZERO FINDINGS` independent review. All Section 8 exclusions remain unchanged.

### 2026-08-29 — Attempt 16: remediated source snapshot rejected temporary target output

**Objective:** begin the fresh source-bound run only after all Attempt 15
remediation is visible to the content snapshot and no build output can be
mistaken for source.

**Prepared remediation:** the native/release-WASM lifecycle adapters now
execute the planar circle and annulus-with-hole case, exact nanometer
local/world inverse transforms, and independent geometry/classification/hash
oracles. The wrong-owner fixture executes body, producer, and component
variants. The durable reference carries its own schema version and component.
Exporter/test commands use structured content-bound provenance and truthful
candidate mappings. The production flow dismisses the Quick Tour before all
eight screenshots, and the current specification separates historical
selection rationale from the implemented automated-pass state.

**Failure:** the source-snapshot gate detected temporary
`artifacts/cargo-target-s4` content. The run stopped before candidate evidence
could be sealed; no files from this attempt are qualifying evidence.

**Remediation:** the temporary Cargo target output was quarantined under the
ignored `target` tree. Source-snapshot generation was rerun against only the
Git-visible source boundary, retaining its explicit qualification-artifact
exclusion and zero-deleted-path assertion.

**Decision:** the fail-closed rejection was correct and created no product
deferral. A complete clean-source rerun remained required.

### 2026-08-29 — Attempt 17: lifecycle golden drift closed from executed clean state

**Objective:** revalidate every frozen lifecycle oracle after topology
references gained their own schema version and component ownership.

**Failure:** the fresh full gate caught lifecycle golden drift. The versioned
topology-reference shape changed canonical persisted documents, so historical
goldens could no longer prove the remediated runtime contract.

**Remediation:** all seven affected goldens were regenerated from forced-clean,
actually executed lifecycles rather than hand-edited expected output. Their
canonical results now retain the reference-local schema version and component
field and remain tied to native runtime execution.

**Executed verification:** the focused golden target passed twice from clean
execution, demonstrating repeatability before another full-gate attempt.

**Decision:** golden drift is closed without weakening canonical equality or
using descriptor-shaped evidence.

### 2026-08-29 — Attempt 18: TypeScript document protocol fail-closed repair

**Objective:** prove that the remediated durable reference survives the web
document and storage boundaries with the same fields native execution requires.

**Failure:** the full gate caught the TypeScript document protocol dropping
`schema_version` and `component` while decoding or re-encoding the topology
reference. That would have made the persisted web representation weaker than
the native contract, so the run stopped.

**Remediation:** the TypeScript document codec and types now preserve both
fields and reject malformed or unknown-version references instead of deriving
or defaulting them. Storage-package coverage was aligned to the same canonical
shape.

**Executed verification:** document-protocol tests passed 7/7 and storage-
protocol tests passed 14/14, including fail-closed negatives and canonical
round trips.

**Decision:** the cross-language persistence finding is closed. A fresh full
source-bound run remained required.

### 2026-08-29 — Attempt 19: bounded rich-oracle evidence schema closure

**Objective:** seal independently frozen planar-face geometry and diagnostic
oracles without weakening evidence-schema rejection.

**Failure:** the full gate completed native, generated release-WASM, parity,
and production-browser execution, but completeness rejected the nested rich
oracle shape. The mechanical execution remained non-qualifying because the
sealed evidence schema could not validate its independent nested geometry and
ownership-mismatch contracts.

**Remediation:** `evidence.schema.json` gained a strict bounded shape for the
canonical nested geometry/orientation and structured diagnostic oracles. The
schema remains closed to unknown keys and does not admit arbitrary recursive
objects. Positive nested-oracle and negative unknown-key self-tests were added.

**Executed verification:** native fixtures passed 10/10, release-WASM fixtures
passed 10/10, parity remained zero-difference, and both completeness preflight
and simulated qualification-ready validation passed after the schema fix.

**Decision:** rich-oracle completeness is closed without a waiver. Because the
schema changed after the rejected run, only another complete source-bound run
could qualify as the automated checkpoint.

### 2026-08-29 — Attempt 20: remediated immutable automated qualification pass

**Objective:** execute the complete no-waiver gate from the exact remediated
source state through isolated post-copy bundle validation.

**Executed gate:** all 27 commands passed: candidate contracts,
command-provenance self-test, source-snapshot self-test, dependency pins, native
workspace, focused native planar-face contracts, native lint, five WASM
workspace checks, document mirror, operation mirror, two deterministic
generation passes, application unit, worker spike, parity and non-parity
self-tests, application build, native evidence, release-WASM evidence,
native/WASM parity, production browser and performance, qualification index,
and bundle integrity.

**Immutable result:**

- run: `artifacts/solid-feature-qualification/runs/20260829T075140Z-solid-feature-sprint-4-r1`;
- report: passed;
- build: `solid-feature-sprint-4-r1-20260828`;
- manifest SHA-256: `62fba43c91f1f86855115ca2902a99a484d14620efd7d246e611bdd0198b7101`;
- commit: `3f2ec88b4687c15cd8721f840ed21b293955f95e`;
- source content SHA-256: `d52a23d001969b578a140ad5aa822c7b47697888dbd9d10a19eb6e1da407e275` under `sha256-git-visible-path-content-v1`, 870 entries/files, zero deleted;
- release-WASM SHA-256: `5408367275d3eabe9781321959bd8da0c4c0443c15ab5d38c4a67bc59a9b6458`, 10,895,809 bytes;
- feature-kernel SHA-256: `c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`;
- operation-catalog SHA-256: `ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`;
- 35 records and 162 checksummed files after isolated sealed-bundle validation;
- ten native and ten release-WASM fixture files, eight unobscured screenshots,
  browser JUnit 2/2, 10/10 zero-difference parity fixture comparisons, and one
  passing aggregate parity JUnit test; and
- zero violations and zero Long Tasks across both locked performance workloads.

**Performance:** `extrude-planar-face-rectangle` ran 2 warmups, 10 measured
iterations, and 50 cancellation cycles: preview p50/p95
51.3000001907349/57.2999999523163 ms, recompute p50/p95 18.4/21.5 ms,
cancellation maximum 52.5 ms, zero Long Tasks, and +1,349,848 bytes observed
heap growth. `planar-face-support-repair` ran 2/10/50: preview p50/p95
63.5/121.600000143051 ms, recompute p50/p95
170.700000047684/242.5 ms, cancellation maximum 37.4000000953674 ms, zero
Long Tasks, +865,068 bytes observed heap growth, one candidate, and 62 ranking
observations.

**Structured rerun:** `run-metadata.json` records the following exact command:

```powershell
pwsh -NoProfile -File scripts/qualify-solid-features.ps1 -Manifest contracts/solid-feature-candidate/sprint-4.json -NativeEvidenceCommand 'cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/native' -WasmEvidenceCommand 'node scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/release-wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm'
```

**Decision:** the remediated automated Sprint 4 gate is **PASSED WITHOUT
WAIVERS** and the nine Attempt 15 findings are closed at the automated-evidence
stage. Sprint 4 is not yet qualified: final completion remains blocked on a
fresh independent review of this exact state returning `ZERO FINDINGS`. All
frozen exclusions and deferrals remain unchanged and unqualified.

### 2026-08-29 — Attempt 21: remediated bundle rejected for TypeScript fail-closed mismatch

**Objective:** independently audit the exact Attempt 20 implementation and
evidence content, including closure of all nine Attempt 15 findings, rather than
accepting the fresh mechanical pass alone.

**Verified evidence:** the independent reviewer confirmed isolated validation
of 35 records and 162 checksummed files, all 27 passing commands, 10/10
native/release-WASM fixture parity, browser JUnit 2/2, unobscured screenshots,
structured command provenance, and the prior nine remediation areas.

**Finding:** TypeScript document persistence checked the canonical decimal
spelling of `stable_kernel_id` but not the `u64` upper bound, so
`18446744073709551616` was accepted even though Rust rejects it. It also accepted
an empty or malformed `fallback_signature`, after which serialization silently
omitted the invalid signature. This violated the frozen canonical-identity and
malformed-reference fail-closed criteria.

**Decision:** Attempt 20 remains immutable historical automated evidence but is
**REJECTED FOR FINAL QUALIFICATION**. The TypeScript persistence boundary must
match Rust exactly, a fresh complete source-bound gate and isolated bundle must
pass, and another independent exact-state review must return `ZERO FINDINGS`.
No waiver is permitted and all exclusions remain unchanged.

### 2026-08-29 — Attempt 22: TypeScript persistence mismatch closed fail closed

**Objective:** make the document and storage protocol boundaries enforce the
same persisted topology-reference domain as Rust before producing another
qualification bundle.

**Remediation:** `stable_kernel_id` is now accepted only as canonical unsigned
decimal text whose exact `BigInt` value is at most `u64::MAX`. The maximum value
`18446744073709551615` round-trips, while
`18446744073709551616`, signed, padded, empty, and otherwise noncanonical forms
fail closed. A persisted `fallback_signature` must now be one of the exact
Rust-compatible variants with its exact keys, kind, three-element signed safe-
integer tuples, and nonnegative safe-integer evidence fields. Invalid values
are rejected during both parse and serialization rather than being omitted.
The storage package codec applies the same validation and canonical ordering.

**Executed verification:** the document-protocol suite passed 8/8, including
the invalid-kernel-ID and exact-fallback-signature cases; the storage-protocol
suite passed 16/16; the focused application protocol suite passed 43/43; and
the TypeScript compile and generated-binding difference checks passed. The
subsequent full gate repeated the document mirror at 8/8 and the application
unit suite at 237/237.

**Decision:** the sole Attempt 21 P1 finding is closed at the implementation
and automated-evidence stage without a waiver. Because the source changed after
the rejected Attempt 20 bundle, only a fresh complete source-bound gate and a
fresh independent exact-state review can advance qualification.

### 2026-08-29 — Attempt 23: post-P1 immutable automated qualification pass

**Objective:** execute the complete no-waiver qualification gate against the
exact post-P1 source and seal a new isolated bundle for independent review.

**Executed gate:** all 27 commands passed: candidate contracts, structured
command-provenance self-test, source-snapshot self-test, dependency pins,
native workspace, focused native planar-face contracts, native lint, five WASM
workspace checks, document mirror, operation mirror, two deterministic
generation passes, application unit, worker spike, parity and non-parity
self-tests, application build, native evidence, release-WASM evidence,
native/WASM parity, production browser and performance, qualification index,
and bundle integrity.

**Immutable result:**

- run: `artifacts/solid-feature-qualification/runs/20260829T084448Z-solid-feature-sprint-4-r1`;
- qualification report: passed at `2026-08-29T01:44:50.2082636-07:00`;
- build: `solid-feature-sprint-4-r1-20260828`;
- manifest SHA-256: `62fba43c91f1f86855115ca2902a99a484d14620efd7d246e611bdd0198b7101`;
- commit: `3f2ec88b4687c15cd8721f840ed21b293955f95e`;
- source content SHA-256: `221cc11345563bc61e7793d01a456d559b670f2fec6734473338ffbdfc3b81e6` under `sha256-git-visible-path-content-v1`, 870 entries/files, zero deleted paths;
- release-WASM SHA-256: `5408367275d3eabe9781321959bd8da0c4c0443c15ab5d38c4a67bc59a9b6458`, 10,895,809 bytes;
- feature-kernel SHA-256: `c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`;
- operation-catalog SHA-256: `ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`;
- 35 records and 162 checksum entries covering every bundle file other than
  `SHA256SUMS.json` after isolated sealed-bundle validation;
- ten native and ten release-WASM fixture files, eight unobscured screenshots,
  browser JUnit 2/2 with zero failures/errors/skips, and 10/10 zero-difference
  native/release-WASM comparisons represented by ten passing testcases in one
  parity JUnit testsuite; and
- zero violations and zero Long Tasks across both locked performance workloads.

**Performance:** `extrude-planar-face-rectangle` ran 2 warmups, 10 measured
iterations, and 50 cancellation cycles: preview p50/p95
46.09999990463257/56.5 ms, recompute p50/p95 17.5/20.5 ms, cancellation maximum
69.10000014305115 ms, zero Long Tasks, and +1,370,932 bytes observed heap
growth. `planar-face-support-repair` ran 2/10/50: preview p50/p95
62.799999952316284/105.5 ms, recompute p50/p95 155.5/238.5 ms,
cancellation maximum 39.700000047683716 ms, zero Long Tasks, +868,084 bytes
observed heap growth, one candidate, and 62 ranking observations.

**Structured rerun:** `run-metadata.json` records the following exact command
with invocation SHA-256
`5bc7b97d18a1e981aa0d6048b891685cd4b20d09ba33242b1aa946d4a0f1e174`:

```powershell
pwsh -NoProfile -File scripts/qualify-solid-features.ps1 -Manifest contracts/solid-feature-candidate/sprint-4.json -NativeEvidenceCommand 'cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/native' -WasmEvidenceCommand 'node scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/release-wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm'
```

**Decision:** the post-P1 automated Sprint 4 gate is **PASSED WITHOUT
WAIVERS**. Sprint 4 is not qualified yet: the mandatory independent reviewer
must audit this exact source, contracts, tests, repeatable harness, immutable
bundle, and reconciled documents and return `ZERO FINDINGS`. Arbitrary/angled/
tangent/three-point/face-derived datum planes; curved/nonanalytic supports;
automatic split/merge or topology-changing healing; generalized or cross-owner
rebind; two-side/start/target extents; Join/Cut/Intersect and targets; handles,
draft, and thin Extrude; and Revolve/Sweep/Loft remain explicitly deferred and
unqualified.

**Evidence wording correction:** earlier historical checkpoints described the
parity JUnit as one aggregate test. The artifact is one JUnit `testsuite` with
ten passing `testcase` entries, one per compared fixture. This correction does
not change any historical run or result.

### 2026-08-29 — Attempt 24: immutable Attempt 23 rejected for Rust fail-closed mismatch

**Objective:** independently audit the exact source, contracts, tests,
repeatable harness, immutable bundle, and reconciled documents from run
`artifacts/solid-feature-qualification/runs/20260829T084448Z-solid-feature-sprint-4-r1`
rather than accepting its complete automated pass as final qualification.

**Finding:** the independent reviewer found one P1 cross-language persistence
mismatch. In `crates/crawler-document/src/lib.rs`, the `decimal_u64`
deserializer parsed a string directly as `u64` and retained a legacy numeric
representation, so Rust accepted noncanonical decimal kernel identities that
the TypeScript document codec and storage boundary rejected. The same file's
`TopologySignature` tagged enum did not deny unknown fields, so Rust also
accepted fallback-signature objects containing undeclared keys while the
TypeScript and storage validators failed closed. Consequently, the Attempt 23
claim that Rust, TypeScript, and storage enforced the same persisted topology-
reference domain was not true for malformed inputs.

**Decision:** Attempt 23 remains immutable historical automated evidence but is
**REJECTED FOR FINAL QUALIFICATION**. E3D-S4-01 is reopened at P1 with
remediation in progress. Rust must enforce the same canonical decimal-string
and exact fallback-signature shape as the TypeScript document and storage
boundaries, with focused positive and negative regression coverage. Because
the required fix changes source after the sealed run, qualification additionally
requires a fresh complete source-bound no-waiver gate, a new isolated immutable
bundle, reconciled documentation, and a new independent exact-state review
returning `ZERO FINDINGS`. No fix or pass is claimed at this checkpoint. Every
frozen exclusion and deferral remains unchanged and unqualified.

### 2026-08-29 — Attempt 25: prior-current quarantine artifacts classified

**Objective:** preserve every run directory created while starting the
post-review remediation sequence without misrepresenting an administrative
quarantine as new qualification evidence.

**Observed directories:**

- `artifacts/solid-feature-qualification/runs/20260829T090357721Z-incomplete`
  contains the same complete 27-command, 35-record, 162-checksum-entry content
  and `run-metadata.json` identity as immutable Attempt 23 run
  `20260829T084448Z-solid-feature-sprint-4-r1`; it is a quarantined prior
  `current` copy, not a new execution or a second pass.
- `artifacts/solid-feature-qualification/runs/20260829T090726258Z-incomplete`
  contains only an empty `SHA256SUMS.json` generated at
  `2026-08-29T02:04:03.7613146-07:00`; it records zero files and no command
  ledger, metadata, test, or product result.

**Decision:** both directories remain retained as incomplete administrative
evidence. Neither advances or weakens Attempt 24, and neither may be counted as
a qualification attempt or pass.

### 2026-08-29 — Attempt 26: canonical Rust identity remediation exposed numeric fixture drift

**Objective:** close Attempt 24 by requiring Rust topology kernel identities to
deserialize only from canonical unsigned decimal strings and by denying
unknown keys on every `TopologySignature` variant.

**Remediation installed:** Rust serialization emits decimal strings;
deserialization rejects numeric values, empty/signed/padded/whitespace forms,
and values above `u64::MAX`; `TopologySignature` now uses
`deny_unknown_fields`. Positive `0`/`u64::MAX` and malformed identity/signature
regressions were added so the Rust boundary matches TypeScript and storage.

**Rejected run:**
`artifacts/solid-feature-qualification/runs/20260829T091925257Z-incomplete`
binds source SHA-256
`f31669710c62e2a07449a35c5fa6782b81f29218bde0e73db869ce586e9133c8`
across 870 entries/files with zero deleted paths. Four commands passed before
`native-workspace` failed with exit 101. The
`same_new_part_command_has_same_fixture_and_semantic_hash` test attempted to
load legacy fixture JSON containing numeric kernel ID `6`; strict Rust correctly
returned `invalid type: integer '6', expected a string`.

**Decision:** the new fail-closed behavior worked, but the source state was
internally inconsistent with its canonical fixtures. The 5-command/8-checksum-
entry run is rejected and stopped before all downstream gates.

### 2026-08-29 — Attempt 27: remaining runtime numeric identity rejected

**Objective:** migrate the canonical fixture boundary exposed by Attempt 26 and
repeat the full source-bound gate.

**Rejected run:**
`artifacts/solid-feature-qualification/runs/20260829T093532180Z-incomplete`
binds source SHA-256
`e0cc428b51c91a3ecb42a13e5fdd9f4c0456e263cef948b1a97933297cb3cf1a`
across 870 entries/files with zero deleted paths. Again four commands passed
before `native-workspace` failed with exit 101. This time the
`topology_face_extrude_repair_is_explicit_atomic_and_durable` runtime test
attempted to deserialize numeric `18446744073709551615`; strict Rust returned
`invalid type: integer '18446744073709551615', expected a string` after 72
other runtime tests passed.

**Decision:** the first fixture drift was closed, but a second test-built
persistence path still emitted a JSON number. The 5-command/8-checksum-entry
run is rejected; no partial pass or waiver is claimed.

### 2026-08-29 — Attempt 28: clean through deterministic generation, then incomplete

**Objective:** align the remaining runtime persistence path, make the storage
protocol mirror an explicit provenance-bound qualification command, and rerun
the complete gate.

**Incomplete run:**
`artifacts/solid-feature-qualification/runs/20260829T100522087Z-incomplete`
binds source SHA-256
`fe203572173ca0725017328427d36e7a8df7bde5c104e9b86c4fb3aeb5ad3106`
across 870 entries/files with zero deleted paths. Its ledger records 17/17
passing commands through `generate-second`, including native workspace,
focused native contracts, lint, all five WASM compile checks, document mirror,
the newly explicit storage mirror, operation mirror, and both deterministic
generation passes. It has 20 checksum entries.

**Shortcoming:** the directory records no failed command and therefore does not
prove a technical failure reason, but it also contains none of the required
application-unit, evidence, parity, browser/performance, record-index, report,
or isolated-bundle gates. The run ended incomplete and cannot qualify.

### 2026-08-29 — Attempt 29: generated release-WASM document boundary rejected

**Objective:** complete the post-Attempt-24 gate after the clean native and
generation checkpoint.

**Rejected run:**
`artifacts/solid-feature-qualification/runs/20260829T102229191Z-incomplete`
binds source SHA-256
`29c3d4380eca3e786649d4d227b34aeb8961458250e775b770c99285ba05d7e6`
across 870 entries/files with zero deleted paths. Twenty-three commands passed,
including native workspace/evidence, mirrors, deterministic generation,
237/237 application units, worker and parity self-tests, and the production
build. `wasm-evidence` then failed with exit 1.

**Failure:** all ten release-WASM fixtures returned structured exporter
`execution_failed` evidence. The representative orientation fixture reported
`document serialization failed: invalid type: integer '26', expected a string
at line 1 column 697`; accepted document and body state remained unchanged.
The run contains 24 command records and 47 checksum entries but no passing
WASM evidence, parity, browser/performance, qualification report, or final
bundle.

**Decision:** the gate correctly rejected a remaining generated-runtime bridge
that supplied numeric topology identities to the now-strict Rust document
boundary. That bridge and generated runtime had to be aligned and regenerated;
no native-only or compile-only result substituted for release-WASM execution.

### 2026-08-29 — Attempt 30: final post-Attempt-24 immutable automated pass

**Objective:** rerun every required no-waiver gate after aligning canonical
identity serialization across Rust, TypeScript, storage, native evidence, and
the generated release-WASM bridge.

**Executed gate:** all 28 commands passed: candidate contracts, structured
command-provenance self-test, source-snapshot self-test, dependency pins,
native workspace, focused native planar-face contracts, native lint, five WASM
workspace checks, document mirror, the explicit storage mirror, operation
mirror, two deterministic generation passes, application unit, worker spike,
parity and non-parity self-tests, application build, native evidence,
release-WASM evidence, native/WASM parity, production browser and performance,
qualification index, and bundle integrity. Document mirror passed 8/8, storage
mirror 16/16, application unit 237/237, and focused native planar-face contracts
5/5.

**Immutable result:**

- run: `artifacts/solid-feature-qualification/runs/20260829T103331Z-solid-feature-sprint-4-r1`;
- qualification report: passed at `2026-08-29T03:33:33.309565-07:00`;
- build: `solid-feature-sprint-4-r1-20260828`;
- manifest SHA-256: `2dd9a81be451d011792eb46ac86275da092f16a20302f14e17c5de4433e16f79`;
- commit: `3f2ec88b4687c15cd8721f840ed21b293955f95e`;
- source content SHA-256: `419dd8c4d9baa4f386b6cbebc0c406935e1a88f3c009780879304ad4a84b0a96` under `sha256-git-visible-path-content-v1`, 870 entries/files, zero deleted paths;
- release-WASM SHA-256: `c8932ce766f9dd9e2e5e27f1fee8ad4fc462b21c3754297c66621cdd0b130c58`, 10,887,489 bytes;
- feature-kernel SHA-256: `c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`, 4,995,660 bytes;
- operation-catalog SHA-256: `ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`, 38,721 bytes;
- 35 records and 163 checksum entries covering all 163 immutable-run files
  other than `SHA256SUMS.json`; the in-step bundle-integrity log validated the
  pre-final-ledger set as 35 records and 162 checksummed files;
- ten native and ten release-WASM fixture files, 10/10 zero-difference parity
  comparisons represented by ten passing JUnit testcases, browser JUnit 2/2
  with zero failures/errors/skips, and eight unobscured screenshots; and
- zero violations and zero Long Tasks across both locked performance workloads.

**Performance:** `extrude-planar-face-rectangle` ran 2 warmups, 10 measured
iterations, and 50 cancellation cycles: preview p50/p95
50.90000009536743/56.60000014305115 ms, recompute p50/p95 17.2/22.7 ms,
cancellation maximum 52 ms, zero Long Tasks, and +1,342,896 bytes observed heap
growth. `planar-face-support-repair` ran 2/10/50: preview p50/p95
62.5/112.79999995231628 ms, recompute p50/p95
133.29999995231628/203.29999995231628 ms, cancellation maximum
35.700000047683716 ms, zero Long Tasks, +860,652 bytes observed heap growth,
one candidate, and 62 ranking observations.

**Environment and rerun:** Rust/Cargo 1.94.0, Node 22.23.1, pnpm 11.19.0,
PowerShell 7.6.4, Windows 10.0.22621 x64, 8 logical CPUs, 68,550,533,120 bytes
memory, and Chrome 151.0.7922.109 headless at 1440×900, DPR 1, one worker,
port 4186. `run-metadata.json` records invocation SHA-256
`5bc7b97d18a1e981aa0d6048b891685cd4b20d09ba33242b1aa946d4a0f1e174`
and this exact rerun:

```powershell
pwsh -NoProfile -File scripts/qualify-solid-features.ps1 -Manifest contracts/solid-feature-candidate/sprint-4.json -NativeEvidenceCommand 'cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/native' -WasmEvidenceCommand 'node scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/release-wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm'
```

**Decision:** current state is **AUTOMATED PASS — INDEPENDENT REVIEW PENDING**
(not qualified). Attempt 24's P1 and Attempts 26, 27, and 29's discovered
inconsistencies are closed at the automated-evidence stage; Attempts 25 and 28
remain retained incomplete history. Final qualification still requires a new
independent exact-state audit of this exact source, contracts, tests, repeatable
harness, immutable bundle, and reconciled documents returning `ZERO FINDINGS`.
Arbitrary/angled/tangent/three-point/face-derived datum planes; curved or
nonanalytic supports; automatic split/merge or topology-changing healing;
generalized/cross-owner support rebind; two-side/start/target extents;
Join/Cut/Intersect and targets; handles, draft, and thin Extrude; and
Revolve/Sweep/Loft remain explicitly deferred and unqualified.

### 2026-08-29 — Attempt 31: Attempt 30 rejected for `external_line` persistence mismatch

**Objective:** independently audit the exact Attempt 30 source, contracts,
tests, repeatable harness, immutable bundle, and reconciled documentation rather
than treating its 28/28 automated result as final qualification.

**P1 finding:** the persisted sketch-element variant `external_line` did not
share one fail-closed contract across all three boundaries. Rust already used
the strict `decimal_u64` serializer/deserializer for
`SketchElement::ExternalLine.stable_kernel_id` and rejected JSON numbers. In the
exact Attempt 30 TypeScript document protocol, the public sketch-element type
and codec omitted the `external_line` variant, so parsing did not validate its
identity and serialization dropped its `body` and `stable_kernel_id` fields.
The storage protocol independently accepted the numeric kernel identity.

**Adversarial observation:** the review probe reported `parsed: true` and
`stored: true`, while TypeScript serialization was lossy. Thus an adversarial
numeric `external_line.stable_kernel_id` survived parse and storage even though
Rust rejected it, and a TypeScript round trip silently changed the element.
This disproved the Attempt 30 claim of a common Rust/TypeScript/storage
persistence domain.

**Review decision:** the independent reviewer did not return `ZERO FINDINGS`.
Attempt 30 remains immutable historical automated evidence but is **REJECTED
FOR FINAL QUALIFICATION**. No waiver or partial qualification is permitted.

**Document remediation installed:** the TypeScript sketch-element union now
includes the exact `external_line` fields; parse and serialization validate the
exact Rust-compatible key set, two-element safe-integer coordinate pairs, and
canonical decimal-string `u64`; serialization preserves `body` and
`stable_kernel_id` rather than dropping them. The document-protocol suite now
passes 11/11, including boundary round trips, numeric/noncanonical rejection,
unknown/missing-field rejection, coordinate-shape rejection, and lossless
serialization.

**Remaining work:** storage remediation and its adversarial regression remain
in progress. After storage closes, the changed source must pass a fresh complete
source-bound no-waiver qualification run and isolated-bundle validation. The
documents must then be reconciled to that new immutable identity, and a fresh
independent exact-state review must return `ZERO FINDINGS`. Until then the
current state is **REJECTED — REMEDIATION IN PROGRESS** (not qualified).
Arbitrary/angled/tangent/three-point/face-derived datum planes; curved or
nonanalytic supports; automatic split/merge or topology-changing healing;
generalized/cross-owner support rebind; two-side/start/target extents;
Join/Cut/Intersect and targets; handles, draft, and thin Extrude; and
Revolve/Sweep/Loft remain unchanged, deferred, and unqualified.

### 2026-08-29 — Attempt 32: `external_line` persistence remediation complete

**Remediation:** storage now matches the remediated document protocol and Rust:
`external_line` has exactly six fields in Rust field order (`kind`, `id`,
`start_nanometers`, `end_nanometers`, `body`, `stable_kernel_id`); coordinate
pairs contain exactly two safe integers; `id` and `body` are nonempty; and the
kernel identity is a canonical decimal string from `0` through `u64::MAX`.
Encode/decode and save/load preserve every field without loss and reject
numeric, malformed, missing, or extra-field forms.

**Focused verification:** document protocol passed 11/11 and storage protocol
passed 19/19.

**Decision:** the Attempt 31 P1 is closed at focused-remediation scope. Current
state is **REMEDIATION COMPLETE — FULL SOURCE-BOUND RERUN PENDING** (not
qualified). A fresh complete no-waiver run, immutable bundle, reconciled
documents, and independent `ZERO FINDINGS` review remain mandatory. Every prior
attempt and every exclusion/deferral remains unchanged.

### 2026-08-29 — Attempt 33: broader persisted-topology-ID audit reopened remediation

**Objective:** audit every persisted topology/kernel identity path after the
focused `external_line` closure instead of assuming that one repaired variant
proved the repository-wide persistence contract.

**Findings:**

- crawler-sketch `ExternalReference` deserialized with `parse::<u64>()`, which
  accepted padded and signed decimal strings rather than the canonical form;
- persisted advanced-feature request topology vectors used JSON numbers;
- the Sprint 4 release-WASM evidence adapter converted identities with
  `Number`, while native evidence accepted numeric identities;
- alpha-reference raw evidence represented the identity numerically; and
- a history regression test typed the persisted identity as a number.

Advanced-feature operations remain functionally deferred from the qualified
Sprint 4 boundary. Their persisted request contract is nevertheless shared
infrastructure and must be canonicalized before the source-bound rerun; the
functional deferral is not a waiver for malformed persistence.

**Remediation installed:** crawler-sketch now accepts canonical decimal strings
only, proves both `0` and `u64::MAX`, and rejects padded, signed, empty,
whitespace, numeric, and out-of-range forms. Its focused suite passed 3/3.

**Remaining work:** canonical-string remediation for advanced-feature request
vectors, the Sprint 4 WASM/native evidence paths, alpha-reference raw evidence,
and the history test remains in progress. Current state is **REMEDIATION IN
PROGRESS — FULL RERUN PENDING** (not qualified). A full source-bound no-waiver
run and new immutable bundle cannot begin until these findings close; fresh
independent `ZERO FINDINGS` review remains mandatory afterward. Attempt 31–32
history and every frozen exclusion/deferral, including functional advanced-
feature deferral, remain unchanged.

### 2026-08-29 — Attempt 34: persisted-ID audit remediation complete

**Closure:** every Attempt 33 path now uses canonical decimal-string topology
identities without changing the frozen functional scope. Crawler-sketch passes
3/3. Feature-kernel uses canonical string serde for Draft, edge-treatment, and
Shell topology-ID arrays and passes 29/29 contracts plus 2/2 persistence tests.
The application builder passes 20/20 plus TypeScript compilation; runtime passes
2/2. The release-WASM exporter preserves strings/`BigInt` and passes 1/1;
native evidence enforces string-only identity and passes 1/1; alpha evidence
passes 5/5; and the history test type is corrected. Document 11/11 and storage
19/19 remain passing.

**Decision:** Attempt 33 is closed at focused-remediation scope. Current state
is **REMEDIATION COMPLETE — FULL SOURCE-BOUND RERUN PENDING** (not qualified).
A fresh complete no-waiver run, immutable bundle, reconciled documents, and
independent `ZERO FINDINGS` review remain mandatory. Draft, edge treatments,
Shell, and all other advanced-feature behavior remain functionally deferred;
canonicalizing their shared persistence contract does not qualify them. Every
prior attempt and every frozen exclusion/deferral remains unchanged.

### 2026-08-29 — Attempt 35: completed Attempt 30 current mirror archived administratively

**Archive:**
`artifacts/solid-feature-qualification/runs/20260829T113815838Z-incomplete`
was created when the first post-Attempt-34 run archived the pre-existing
`current` directory. The directory is a completed mirror of Attempt 30, not a
new execution of the remediated source: it retains manifest SHA-256
`2dd9a81be451d011792eb46ac86275da092f16a20302f14e17c5de4433e16f79`,
source SHA-256
`419dd8c4d9baa4f386b6cbebc0c406935e1a88f3c009780879304ad4a84b0a96`
under `sha256-git-visible-path-content-v1` across 870 files with zero deleted
paths, 28/28 passing commands, a passing qualification report, 35 records, and
163 checksum entries.

**Decision:** the `-incomplete` name describes administrative archival state,
not a newly observed technical failure. Because its identity is the already
rejected Attempt 30 source and manifest, it supplies no post-remediation
qualification evidence and does not change the Attempt 31 rejection.

### 2026-08-29 — Attempt 36: environment-bound application-unit rejection

**Rejected run:**
`artifacts/solid-feature-qualification/runs/20260829T115821960Z-incomplete`
binds current candidate manifest SHA-256
`4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`
and source SHA-256
`3b1511f58c61d92ff568157bcb88dc6074fbd7851ee12b8841f0f2719a9942d3`
across 870 files with zero deleted paths. Seventeen commands passed before
`app-unit` failed, leaving 18 command records and 21 checksum entries.

**Failure:** Node terminated before the application tests could execute with
`EPERM: operation not permitted, stat 'C:\Volta'`. This was a sandbox/toolchain
resolution failure, not a test assertion. No later application, evidence,
parity, browser/performance, record-index, report, or bundle gate exists in the
archive.

**Decision:** the attempt is rejected and cannot qualify. A workspace-local
tool shim preserving Node 22.23.1, pnpm 11.19.0, and the manifest's exact pnpm
arguments was used for the next complete rerun; the environment workaround is
not product evidence and does not waive any gate.

### 2026-08-29 — Attempt 37: full run rejected at native/release-WASM parity

**Rejected run:**
`artifacts/solid-feature-qualification/runs/20260829T121358296Z-incomplete`
binds manifest SHA-256
`4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`
and source SHA-256
`3b1511f58c61d92ff568157bcb88dc6074fbd7851ee12b8841f0f2719a9942d3`
across 870 files with zero deleted paths. Twenty-four commands passed before
`native-wasm-parity` failed, leaving 25 command records and 50 checksum
entries. The passing prefix includes native workspace and focused contracts,
five WASM compilation gates, document 11/11, storage 19/19, application unit
240/240, worker 13/13, parity self-test 15/15, non-parity 6/6, production
build, and ten native plus ten release-WASM evidence exports.

**Failure:** parity passed 8/10 fixtures. Only accepted-document hashes differed
for `planar-face-broken-support-explicit-repair` (before and after) and
`planar-face-ambiguous-repair-refused` (before and after); every other compared
field and fixture matched. Investigation found that the release-WASM adapter
correctly used the full canonical `u64::MAX` broken-reference value while the
native evidence generator used a different sentinel. This was an evidence-
document mismatch, not a native/release-WASM product-result mismatch.

**Decision:** parity is mandatory, so the run is rejected despite its passing
prefix. It contains no browser/performance, qualification report, record index,
or final immutable bundle.

### 2026-08-29 — Attempt 38: evidence sentinel remediated; focused parity passed

**Remediation:** native `break_topology_reference` now writes
`u64::MAX.to_string()` so both native and release-WASM evidence construct the
same canonical full-range invalid-current-reference document. The release-WASM
path was already correct and was not weakened. Independent artifact comparison
confirmed that the discrepancy was confined to this evidence input.

**Focused verification:** under
`target/sprint4-focused-parity-20260829T121122215Z`, the native exporter wrote
ten fixtures, the generated release-WASM exporter wrote ten fixtures, and the
unchanged parity comparator passed 10/10 with zero differences against manifest
SHA-256
`4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`.
The exact focused sequence was:

```powershell
cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-4.json --output target/sprint4-focused-parity-20260829T121122215Z/native
target/tool-shim/node.exe scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --output target/sprint4-focused-parity-20260829T121122215Z/wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm
target/tool-shim/node.exe scripts/compare-solid-feature-parity.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --native target/sprint4-focused-parity-20260829T121122215Z/native --wasm target/sprint4-focused-parity-20260829T121122215Z/wasm --output target/sprint4-focused-parity-20260829T121122215Z/parity/parity.json --junit target/sprint4-focused-parity-20260829T121122215Z/parity/parity.junit.xml
```

**Decision:** Attempt 37's focused parity blocker is closed. Current state is
**FOCUSED PARITY REMEDIATION PASSED — FULL SOURCE-BOUND RERUN PENDING** (not
qualified). The changed source still requires a fresh complete no-waiver run,
new immutable bundle, reconciled final documents, and independent exact-state
review returning `ZERO FINDINGS`. Every previous attempt remains retained.
Arbitrary/angled/tangent/three-point/face-derived datum planes; curved or
nonanalytic supports; automatic healing, split/merge, or topology-changing
rebind; cross-component/cross-support/general rebind; two-side/start/target
extents; Join/Cut/Intersect and targets; handles, draft, and thin Extrude; and
Revolve/Sweep/Loft remain deferred and unqualified.

### 2026-08-29 — Attempt 39: source-snapshot race rejected after browser pass

**Rejected run:**
`artifacts/solid-feature-qualification/runs/20260829T122635405Z-incomplete`
binds candidate manifest SHA-256
`4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`
and the initially captured source SHA-256
`d5520d32d15ac939f15bbd5a3448b772441f0a89e8809a338155978375455c32`
under `sha256-git-visible-path-content-v1` across 870 entries/files with zero
deleted paths. Its 26 recorded commands all exited successfully, including ten
native fixtures, ten generated release-WASM fixtures, 10/10 parity, and
production browser JUnit 2/2 with zero failures, errors, or skips.

**Failure:** the mandatory post-browser source recheck rejected the run before
indexing, report, checksum completion, and sealing. It expected the captured
source SHA-256
`d5520d32d15ac939f15bbd5a3448b772441f0a89e8809a338155978375455c32`
but observed
`1853adee34b4febc4f76277b54941251efc8c00f33a45926be1d80a2125bd3cc`.
Concurrent qualification-document edits changed the Git-visible source while
the gate was running. This is a source-binding failure even though the executed
prefix passed.

**Decision:** Attempt 39 is rejected and cannot qualify. Its passing prefix is
retained only as historical diagnostic evidence; no source-race waiver is
permitted.

### 2026-08-29 — Attempt 40: complete post-remediation automated pass

**Immutable run:**
`artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`
passed every frozen automated gate and sealed successfully. It binds candidate
manifest SHA-256
`4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`,
Git commit `3f2ec88b4687c15cd8721f840ed21b293955f95e`, and source SHA-256
`f4f01a45db55c2626a36c7a161db6da788e62b650cbc73efb1035ca0d87a76f6`
under `sha256-git-visible-path-content-v1` across 870 entries/files with zero
deleted paths. The source exclusion remains only
`artifacts/solid-feature-qualification/**`.

**Complete gate:** 28/28 commands passed. The source-bound run includes the
full native workspace, focused native planar-face contracts 5/5, zero-warning
lint, five release-WASM compilation gates, document protocol 11/11, storage
protocol 19/19, operation mirror 7/7, deterministic generation, application
unit 240/240, worker 13/13, parity self-tests 15/15, non-parity self-tests 6/6,
production build, ten native and ten generated release-WASM exports, 10/10
zero-difference native/WASM parity, and production browser JUnit 2/2 with zero
failures, errors, or skips. Eight unobscured screenshots are retained.

**Performance:** both locked workloads passed with zero violations and zero
Long Tasks. `extrude-planar-face-rectangle` ran 2 warmups, 10 measured
iterations, and 50 cancellation cycles: preview p50/p95
48.200000047683716/54.700000047683716 ms, recompute p50/p95 18/21.1 ms,
cancellation maximum 51.89999985694885 ms, and +1,363,204 bytes observed heap
growth. `planar-face-support-repair` ran 2/10/50: preview p50/p95
63.299999952316284/118.90000009536743 ms, recompute p50/p95
128.5/231.70000004768372 ms, cancellation maximum 42.700000047683716 ms,
+866,640 bytes observed heap growth, one candidate, and 62 deterministic ranking
observations.

**Locks and bundle:** runtime build ID is
`solid-feature-sprint-4-r1-20260828`; generated release-WASM SHA-256 is
`0e1f3cb3b3c1605df02ee34e87546563ee199a3678bb7d7b6b3c810cf5e9cd89`
(10,893,016 bytes). Feature-kernel SHA-256 remains
`c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`
(4,995,660 bytes), and operation-catalog SHA-256 remains
`ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`
(38,721 bytes). The isolated bundle contains 35 qualification records and 163
checksum entries; its in-step validator passed the pre-final-ledger set at 35
records and 162 checksummed files. `qualification-report.json` reports
`status: passed`, and post-copy isolated-bundle validation passed. The recorded
qualification invocation SHA-256 is
`5bc7b97d18a1e981aa0d6048b891685cd4b20d09ba33242b1aa946d4a0f1e174`.

**Decision:** current state is **AUTOMATED PASS — INDEPENDENT REVIEW PENDING**
(not qualified). Attempt 40 closes the complete post-remediation automated
gate, but final qualification still requires a fresh independent exact-state
audit of this source, contracts, tests, repeatable harness, immutable bundle,
and reconciled documents returning `ZERO FINDINGS`. Every prior rejection and
remediation remains append-only history. Arbitrary/angled/tangent/three-point/
face-derived datum planes; curved or nonanalytic supports; automatic healing,
split/merge, or topology-changing rebind; cross-component/cross-support/general
rebind; two-side/start/target extents; Join/Cut/Intersect and targets; handles,
draft, and thin Extrude; and Revolve/Sweep/Loft remain deferred and unqualified.

### 2026-08-29 — Attempt 41: independent zero-finding qualification gate

**Independent review:** fresh reviewer `/root/sprint4_zero_gate_attempt40`
audited the current Sprint 4 source and contracts, immutable Attempt 40 bundle
`artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`,
repeatable qualification harness, test coverage, native/release-WASM parity,
production browser and performance evidence, reconciled documentation, recorded
shortcomings, and explicit deferrals. The review returned the exact standalone
verdict `ZERO FINDINGS`.

**Decision:** Sprint 4 revision 1 is **QUALIFIED** for the frozen included
boundary: current analytic planar-face-supported Blind New Body Extrude over
qualified line/arc/circle/hole profiles, including explicit compatible repair
on the same body, producer, and component. Attempt 40 remains the immutable
automated evidence identity, and Attempt 41 supplies the mandatory independent
completion gate. No waiver, partial result, or historical rejected bundle is
used for this decision.

**Completion and next step:** Sprint 4 is complete. The next modernization
slice must be selected and frozen separately against the initiative dependency
order; this qualification does not pull forward any deferred capability.
Arbitrary/angled/tangent/three-point/face-derived datum planes; curved or
nonanalytic supports; automatic topology healing, split/merge naming, or
topology-changing rebind; cross-component/cross-support/general rebind;
two-side/start/target extents; Join/Cut/Intersect and targets; handles, draft,
and thin Extrude; and Revolve/Sweep/Loft remain explicitly deferred and
unqualified.

### 2026-08-29 — Attempt 42: final documentation-only zero-finding re-review

**Documentation gate:** the same independent reviewer,
`/root/sprint4_zero_gate_attempt40`, re-reviewed the final reconciled Sprint 4
completion set across the qualification ledger, Sprint 4 specification,
initiative record, and backlog, together with the successful `git diff --check`
result. The reviewer returned the exact standalone verdict `ZERO FINDINGS`.

**Final decision:** all Sprint 4 completion gates are closed. No required work
remains for the bounded qualified scope. Attempt 40 is the immutable automated
evidence bundle, Attempt 41 is the independent exact-state zero-finding gate,
and Attempt 42 is the same reviewer's final documentation-only zero-finding
gate. Sprint 4 revision 1 remains **QUALIFIED** without waiver.

All recorded shortcomings and prior rejected attempts remain append-only
history. Arbitrary/angled/tangent/three-point/face-derived datum planes;
curved/nonanalytic supports; automatic topology healing, split/merge naming,
or topology-changing rebind; cross-component/cross-support/general rebind;
two-side/start/target extents; Join/Cut/Intersect and targets; handles, draft,
and thin Extrude; and Revolve/Sweep/Loft remain deferred and unqualified. They
are not required work for the completed Sprint 4 bounded scope.
