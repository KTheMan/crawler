# Solid Feature Sprint 1 Qualification

**Candidate:** `solid-feature-sprint-1` revision 5 (revision 4 evidence superseded)  
**Last updated:** 2026-08-26  
**Current decision:** **QUALIFIED**

This report is the durable completion ledger for E3D-S1-13 through E3D-S1-15.
It must not be changed to **QUALIFIED** until `scripts/qualify-solid-features.ps1`
returns zero and its immutable evidence bundle passes checksum verification.

## Candidate state

| Item | State | Evidence / shortcoming |
|---|---|---|
| Candidate scope | Complete | The same nine P0 stories are frozen in `contracts/solid-feature-candidate/sprint-1.json`; P1 capabilities remain excluded. |
| Manifest and fixture schemas | Complete | The revision 5 manifest and all 21 fixture descriptors passed JSON Schema and semantic-reference validation. |
| Incomplete-candidate rejection | Complete | Negative manifest checks passed; omissions and duplicate story IDs fail closed. |
| Runtime artifact lock | Complete | Build `solid-feature-sprint-1-r5-20260826` reproduced release-WASM SHA-256 `c1f57b5e4f946b4ed3cf3aad4fc6f039d1cd53cd5b370b6015c7a16f9274746f`. |
| Native evidence adapter | Complete | All 15 descriptor/input-bound native runtime fixtures passed, including upstream edit/recompute and exact nonempty identities. |
| Release-WASM evidence adapter | Complete | The manifest-locked generated release WASM passed the same 15 fixture-owned oracles. |
| Native/WASM comparator | Complete | Native/release-WASM parity passed 15/15; comparator self-tests passed 7/7 and non-parity self-tests passed 6/6. |
| Production Playwright profile | Complete | Six production-preview tests passed across all four manifest IDs, including same-sketch replacement and fail-closed cross-sketch rejection. |
| Performance budgets | Complete | Both locked workloads passed preview, recompute, cancellation, long-task, and memory budgets. |
| Full candidate qualification | Qualified | All 25 command stages returned zero, 55 fail-closed records and 169 checksummed files were sealed, the timestamped copy passed isolated link/hash validation, and the fresh independent review reported zero findings. |

## Frozen scope

The required story IDs are `E3D-S1-05`, `E3D-S1-06`, `E3D-S1-07`,
`E3D-S1-08`, `E3D-S1-11`, `E3D-S1-12`, `E3D-S1-13`, `E3D-S1-14`, and
`E3D-S1-15`. A scope change requires a manifest revision and invalidates all
evidence carrying the earlier manifest SHA-256. Candidate waivers are forbidden.

## Qualification commands

Structural validation, safe before artifact freeze:

```powershell
pwsh -NoProfile -File scripts/test-solid-feature-candidate.ps1
pwsh -NoProfile -File contracts/solid-feature-candidate/test/manifest-validation.tests.ps1
node --test scripts/test-solid-feature-parity.mjs
```

Full qualification command:

```powershell
pwsh -NoProfile -File scripts/qualify-solid-features.ps1 `
  -NativeEvidenceCommand 'pwsh -File scripts/export-solid-feature-runtime-evidence.ps1 -Runtime native' `
  -WasmEvidenceCommand 'pwsh -File scripts/export-solid-feature-runtime-evidence.ps1 -Runtime release-wasm'
```

The exporter commands must write records under
`artifacts/solid-feature-qualification/current/runtime/native` and
`artifacts/solid-feature-qualification/current/runtime/release-wasm`. Each file
is named `<fixture-id>.json` and validates against
`contracts/solid-feature-candidate/evidence.schema.json`.

## Gate behavior

The release gate runs locked dependency checks, the native workspace, Clippy,
wasm32 compilation, protocol mirrors, two byte-identical generator passes,
production application build, native and release-WASM evidence exporters,
parity comparison, and production-preview browser tests. Revision 5 records the
commit plus a path/content/deletion-addressed Git-visible source manifest, host/
tool/browser metadata, bundle-relative command logs and exit codes, geometry
evidence, materialized descriptors and locked runtime, JUnit, screenshots, raw
performance results, and checksums. The source digest is rechecked before
preflight and finalization, and the copied timestamped bundle is validated with
no worktree/current path resolution.
Before a new qualifying run, any existing `current` staging bundle is preserved
under `artifacts/solid-feature-qualification/runs/<timestamp>-incomplete`; the
harness never deletes or overwrites prior evidence.

The final completeness pass requires one `passed` record for every required
story, fixture, test, and artifact. E3D-S1-13's story record and its manifest
self-test are excluded from recursive evidence. No other candidate item may be
skipped, blocked, failed, or waived.

## Qualification completion hooks

1. **Complete:** stable runtime build ID is assigned, the manifest is
   `qualification_ready`, and both runtime lock locations contain the verified
   release-WASM SHA-256.
2. **Complete:** native and release-WASM fixture
   exporters emit positive geometry or structured negative results plus
   before/after accepted-document and body hashes. No field derived from fixture
   expectations may substitute for an observed runtime result.
3. **Complete:** manifest-named production browser tests exist:
   `solid-feature-runtime-identity.spec.ts`,
   `solid-feature-qualification.spec.ts`, and
   `solid-feature-performance.spec.ts`.
4. **Complete:** browser tests write explicit passing screenshots and raw
   performance observations; failures are persisted before assertions. An empty
   screenshot directory fails artifact validation.
5. **Complete:** the record writer emits schema-valid records
   for each fixture, test, artifact, and non-self-referential story and requires
   exact manifest-owned browser-suite coverage.
6. **Complete:** the revision 5 full gate is linked to the timestamped immutable directory
   in the completion section below.
7. **Complete:** the fresh independent read-only revision 5 review reported zero
   issues and satisfied the sprint completion gate.

## Deferred and non-candidate work

Construction-plane Extrude, reverse/symmetric extents, Join, Cut, Sweep, Loft,
planar-face support, cross-sketch reference replacement, separate support
rebinding, dedicated region/support locate-remove chips, target chips, result-mode
editing, advanced extents, taper, thin features, and multi-target scope remain
outside this candidate. Observations about those capabilities may
be recorded only with owner, rationale, expiry, affected evidence, and follow-up;
they cannot waive or satisfy a candidate comparison.

## Revision 4 selected-replacement remediation result (superseded)

Revision 4 closes the sole issue from the independent revision 3 audit without
changing candidate acceptance or deferred scope. Production browser evidence
uses a **distinct compatible region in the stored source sketch/support** as the
replacement and proves:

1. selecting the distinct replacement and entering timeline edit resolves the
   replacement references without mutating the accepted feature;
2. cancel restores the original references, feature identity, body identity,
   geometry, recompute result, and reload result;
3. repeating the distinct replacement and committing persists the replacement
   references while retaining the owning feature and body identities; and
4. committed geometry, recompute, and save/reload all agree with the replacement
   definition rather than the original region.

The cancel, commit, recompute, and reload assertions are all true, and the
recorded worker invocation counts are `[1, 1, 1]`. The revision 4 manifest,
fixture, production-browser result, and immutable bundle bind these observations;
the independent review later confirmed these observations. Distance-only timeline-edit
coverage from revision 3 did not substitute for selected-replacement evidence.

## Revision 5 cross-sketch boundary remediation result

The revision 4 independent audit found that a selected profile from another
sketch/support could enter timeline replacement even though cross-sketch
replacement is deferred. Revision 5 requires the selected replacement to have
the exact stored source sketch ID and requires both supports to resolve `ready`
to equal plane frames. An incompatible cross-sketch selection now blocks Edit
Extrude with the explicit source-sketch/resolved-support reason before any
preview or commit.

Production evidence records zero `preview-extrude` and zero `commit-pad`
dispatches for the blocked attempt. The accepted document hash, source sketch,
support and region references, feature/body IDs, profile geometry and bounds,
and feature count remain unchanged through recompute and reload. Cross-sketch
replacement and support rebinding remain deferred rather than qualified.

## Completion record

| Field | Value |
|---|---|
| Final status | QUALIFIED |
| Revision 5 qualifying source | Commit `3f2ec88b4687c15cd8721f840ed21b293955f95e` plus content-addressed source snapshot `d3b7a13708685e4dc3968f71f392d36c82f004a90705f8b726e3b827381f3260` (557 tracked/nonignored entries; 557 files; 0 deletions; qualification artifacts excluded). |
| Revision 5 manifest / build / runtime lock | Manifest SHA-256 `f0bd46340f256a7f8624738b9d5cf07ae6b952dd2a4b79c25830345866d5f80b`; build `solid-feature-sprint-1-r5-20260826`; release-WASM SHA-256 `c1f57b5e4f946b4ed3cf3aad4fc6f039d1cd53cd5b370b6015c7a16f9274746f`. |
| Revision 5 immutable evidence bundle | `artifacts/solid-feature-qualification/runs/20260826T115242Z-solid-feature-sprint-1-r5` (`SHA256SUMS.json` digest `777d653627b27248b96ee8c734cd60fbd8e05c2cd69e603591ca2e47c5849eaa`). |
| Superseded revision 4 source | Commit `3f2ec88b4687c15cd8721f840ed21b293955f95e` plus content-addressed source snapshot `7987b8ad719d582fe93d37d0138f8e4b05d15a930d7428c30fa6c08c81bd4d05` (557 Git-visible entries/files; 0 deletions; qualification artifacts excluded). |
| Superseded revision 4 manifest / runtime | Manifest SHA-256 `a6cbb9e925a4f4d34804209c5ffdfa4999fae75cb4e4a70ff7ce7b0becc47afc`; build `solid-feature-sprint-1-r4-20260826`; release-WASM SHA-256 `c1f57b5e4f946b4ed3cf3aad4fc6f039d1cd53cd5b370b6015c7a16f9274746f`. |
| Superseded revision 4 evidence | `artifacts/solid-feature-qualification/runs/20260826T105732Z-solid-feature-sprint-1-r4` (`SHA256SUMS.json` digest `da4319f0da08af6778f62ac1a216b66d56cd12125f70779657e51c3131071be5`). Retained as immutable historical evidence only. |
| Superseded revision 3 source | Commit `3f2ec88b4687c15cd8721f840ed21b293955f95e` plus content-addressed source snapshot `3bd6568cbea7ed0a31b0da77b0fed7c814d62ba0865f4f7ec595fa3c47d342d2` (557 Git-visible files; qualification artifacts excluded). |
| Superseded revision 3 manifest / runtime | Manifest SHA-256 `7954f5a2237a717470f7aefecc34ad310570e9ff8bf329c831c4406491a1365c`; build `solid-feature-sprint-1-r3-20260826`; release-WASM SHA-256 `c1f57b5e4f946b4ed3cf3aad4fc6f039d1cd53cd5b370b6015c7a16f9274746f`. |
| Superseded revision 3 evidence | `artifacts/solid-feature-qualification/runs/20260826T094412Z-solid-feature-sprint-1-r3` (`SHA256SUMS.json` digest `ba26f0a3f05d33ec08b4bd64a5787174793d1ef5215bde1d157e91ea80ac2370`). Retained as immutable historical evidence only. |
| Independent review | Revision 5 review reported zero findings; the completion gate is satisfied. Revision 4 remains rejected because cross-sketch selection could enter the deferred replacement path. |
| Known candidate shortcomings | None open in the qualified candidate. Explicit non-candidate scope remains deferred as listed above. |

The revision 5 source snapshot above is the exact state executed by the automated
gate. After it passed, only these four completion ledgers may change:
`docs/BACKLOG.md`, this file,
`docs/specs/solid-feature-modernization-initiative.md`, and
`docs/specs/solid-feature-modernization-sprint.md`. The final independent review
covered those documentation-only deltas as well as the immutable source and
evidence bundle and reported zero findings.

Append dated entries below; do not replace earlier failure or shortcoming history.

### 2026-08-25 — Qualification infrastructure checkpoint

- Added the scope-frozen manifest, schemas, 21 fixture descriptors, semantic
  validator, negative self-tests, parity comparator, production browser profile,
  environment profile, performance budgets, and fail-closed release harness.
- Structural validation and parity comparator self-tests pass.
- No runtime artifact or product capability is marked qualified.

### 2026-08-25 — Runtime, parity, and browser checkpoint

- Assigned and enforced the revision 1 runtime build ID for the initial smoke.
- Native and generated release-WASM smoke evidence agreed for all 17
  parity-required fixtures. This smoke directory is diagnostic, not the
  immutable result of the full qualification command.
- Production runtime-identity and create/edit/undo/redo/reload browser workflows
  passed against the locked generated runtime.
- Canonical storage ordering and stable document recovery were corrected and
  covered by protocol and lifecycle tests.

### 2026-08-25 — Fail-closed performance checkpoint

- The complete failed checkpoint is retained under
  `artifacts/solid-feature-qualification/runs` as immutable incomplete history
  rather than represented as a pass. Annulus preview p50/p95 measured
  454.4/777.6 ms against 150/350 ms;
  recompute p50/p95 measured 520/860.1 ms against 225/500 ms; the maximum main
  thread long task measured 62 ms against 50 ms. Cancellation (2.1 ms) and
  memory growth (13,450,944 bytes) passed.
- Diagnosis proved the exact extent-edit route was selected. The dominant cost
  was generic nanometer-adaptive circle/circle intersection during annulus
  region classification, compounded by repeated historical solid parsing and a
  redundant accepted-distance preview. Analytic circle/circle classification,
  latest-matching-body lookup, and preview de-duplication are implemented and
  await locked production requalification.
- The performance specification now persists observations and violations before
  assertions, so a future failure cannot be mistaken for missing evidence.

### 2026-08-25 — Evidence-integrity review checkpoint

- Independent audit found that early exporter drafts normalized some positive
  and negative fields from fixture expectations. Those records are not accepted
  as qualification evidence.
- Final exporter hardening must derive topology, identity, classification, and
  structured refusal fields from actual native/release-WASM runtime results and
  fail on unrecognized output. The full qualifier and immutable bundle remain
  pending until that verification passes.

### 2026-08-25 — Candidate revision 2 evidence correction

- The evidence-integrity audit proved revision 1 parity could agree on a shared
  exporter-authored scenario without satisfying the fixture descriptor. No
  revision 1 smoke record is accepted as qualification evidence.
- Candidate revision 2 binds every runtime record to the manifest fixture and
  normalized input SHA-256, compares every declared oracle/error/identity field,
  and validates executed lifecycle steps. Shared native/WASM substitution now
  fails before parity comparison.
- Fifteen geometry/runtime fixtures remain native/release-WASM parity fixtures.
  Six UI/harness fixtures are bound to exact browser or negative self-test
  evidence rather than receiving synthetic runtime records.
- Factual oracle corrections record the actual typed architecture: circles are
  exact-rational `nurbs_surface` faces rather than analytic kernel cylinders;
  feature profiles reference one `RegionDefinitionV2` whose ordered outer/hole
  geometry IDs are durable; the legacy matrix preserves V1/V2 without implicit
  migration and rejects future/downgrade requests.
- Final regenerated release artifact is locked as build
  `solid-feature-sprint-1-r2-20260825`, SHA-256
  `0b10d1c88b49df73394b1bd5f68c11876efc82c6dc4947fd12bd330e8b4cc4c5`.
  This was the intermediate revision 2 lock at that checkpoint; the final
  lint-safe regenerated artifact and current lock are recorded in the 2026-08-26
  qualification entry below.

### 2026-08-25 — Revision 2 focused performance checkpoint

- The first focused revision 2 run proved the geometry remediation: rectangle
  preview p50/p95 was 4.4/6.0 ms and recompute p50/p95 was 13.5/17.1 ms.
- The run still failed closed before annulus because one 58 ms main-thread long
  task exceeded the 50 ms budget. Its machine-readable failure was persisted.
  This run occurred while parallel qualification compilation/export work was
  active and is not promoted or discarded; the full isolated production gate
  must pass the unchanged budget.

### 2026-08-26 — Full-gate remediation history

Every failed attempt was retained rather than overwritten. The following
incomplete bundles record the issue that stopped each run and the remediation
that subsequently passed:

- `20260826T071331481Z-incomplete`: `sccache` could not spawn `rustc`; the
  qualifying run used the same toolchain with `RUSTC_WRAPPER` disabled.
- `20260826T071714499Z-incomplete`: the alpha-reference legacy shell composer
  omitted the newly added optional surface-area and centroid evidence fields;
  both are now explicitly `None` for that legacy path.
- `20260826T072025300Z-incomplete` and
  `20260826T072416810Z-incomplete`: exact operation-catalog and DXF golden tests
  exposed CRLF checkout drift. Generated/golden files were normalized and
  targeted LF attributes were added.
- `20260826T072834365Z-incomplete` and
  `20260826T073245941Z-incomplete`: strict Clippy found sketch/runtime type,
  iterator, dereference, recursion-signature, and collapsible-branch issues.
  They were refactored without lint allowances; workspace `--all-targets -D
  warnings` subsequently passed.
- `20260826T074612061Z-incomplete`: canonical document fixtures and operation
  mirror expectations were stale. Canonical fixture line endings and the typed
  operation catalog expectations were corrected.
- `20260826T075735478Z-incomplete`: the real-WASM worker test still expected the
  now-supported CSG STEP fixture to fail. It now verifies the observed imported
  body bounds, provenance, shell/face counts, and triangulation.

### 2026-08-26 — Automated candidate qualification passed

- The full locked command completed with zero exit status and produced
  `artifacts/solid-feature-qualification/runs/20260826T080813Z-solid-feature-sprint-1-r2`.
- All 23 recorded command stages passed; 54 fail-closed qualification records
  were indexed. Native and release-WASM oracles and parity passed for all 15
  runtime fixtures. Application tests passed 212/212, worker contracts 13/13,
  parity self-tests 6/6, non-parity self-tests 6/6, and production browser tests
  5/5.
- Rectangle performance passed at preview p50/p95 3.3/6.9 ms and recompute
  p50/p95 10.3/20.0 ms. Annulus passed at preview 5.7/10.0 ms and recompute
  18.7/29.8 ms. Both recorded zero main-thread long tasks, cancellation below
  2.5 ms, and memory growth below the 32 MiB budget.
- The final candidate binds manifest SHA-256
  `5a72519beb42b044921a942b20a02a62748d887a650198c20e6e74a34beda265`
  to release-WASM SHA-256
  `c1f57b5e4f946b4ed3cf3aad4fc6f039d1cd53cd5b370b6015c7a16f9274746f`.
- Automated qualification is complete. The user-required independent
  zero-finding review remains pending and is not waived by this pass.

### 2026-08-26 — Independent audit invalidated revision 2 completion

- The reviewer verified all 127 listed checksums, 15/15 parity results, 5/5
  browser results, and both performance workloads, but reported five blockers.
  Therefore the automated pass above is retained only as historical evidence.
- `dirty_tree_sha256` bound only porcelain status/path text, not file bytes, and
  qualification output paths polluted that status. Revision 3 replaces it with
  a deterministic content manifest and start/end source-snapshot check.
- Records in the timestamped copy pointed back to mutable `current` and worktree
  paths. Revision 3 materializes descriptors, schemas, production index, and the
  locked WASM in each bundle; records use bundle-relative paths and an isolated
  validator rechecks all links and checksums after the timestamped copy.
- E3D-S1-11's original locate/remove/target-chip criterion exceeded the delivered
  positive-blind New Body workflow and depended on deferred S09/S10. Revision 3
  narrows the accepted UI contract to the implemented region/support resolution
  and compatible selected-replacement edit flow. Dedicated chips remain listed
  as deferred work rather than being represented as complete.
- Revision 3 now adds actual operation-level legacy golden workflows, future and
  downgrade failure execution, upstream sketch recompute through generated
  release-WASM evidence, and nonempty fixture-owned retained/replaced identities.
  Focused tests pass; the complete candidate gate remains required.
- No revision 3 story may be marked complete until the full gate passes and a
  fresh independent review reports zero findings.

### 2026-08-26 — Revision 3 audit remediation and qualification

- Revision 3 froze the same nine P0 story IDs while correcting E3D-S1-11 to the
  delivered positive-blind New Body interaction boundary. Separate support
  rebinding, dedicated reference display/locate/remove chips, target chips, and
  result-mode editing remain explicitly deferred.
- Source identity is now the ordinal, length-framed SHA-256 manifest of all 557
  Git-visible tracked/nonignored-untracked files and deletion markers. The final
  source snapshot is
  `3bd6568cbea7ed0a31b0da77b0fed7c814d62ba0865f4f7ec595fa3c47d342d2`;
  qualification output is the only declared exclusion, and start/preflight/end
  digests must agree.
- Every record path in the qualifying bundle is bundle-relative. Candidate
  schemas/descriptors, legacy golden sources, production index, and the locked
  release WASM are materialized under `inputs/`. The timestamped copy validates
  in isolation with 55 records and 169 checksummed files; no record, command, or
  report resolves through mutable `current` or worktree evidence paths.
- Seven legacy V1 operation goldens (Extrude, Extrude Cut, Revolve, Revolve Cut,
  Loft, Sweep, Boolean) execute preview/create/save/open/recompute/edit/save/
  reopen with exact body/document digests. Adjacent migration is deterministic
  and idempotent; actual future-version, downgrade, unknown capability/enum, and
  malformed migration requests fail atomically.
- `extrude-reload-edit` performs a real same-ID rectangle-to-circle upstream
  sketch edit after reload in both native and generated release-WASM runtimes,
  then recomputes and observes a circle profile, exact final bounds, 6 retained
  identities, and 20 replaced identities. A negative comparator self-test proves
  matching empty runtime sets cannot satisfy a nonempty fixture declaration.
- Revision 3 failed closed twice before its final pass. The run archived as
  `20260826T090605462Z-incomplete` records a transient `cargo` process exit `-1`;
  the unchanged exact workspace command then passed. The run archived as
  `20260826T092157245Z-incomplete` records the completeness validator's old
  repository-relative browser/fixture path assumption; the staged bundle passed
  after that validator was corrected to bundle-relative identity.
- `20260826T093247Z-solid-feature-sprint-1-r3` passed automatically, but a
  post-pass audit found redundant artifact `details.manifest_path` diagnostics
  containing mutable `current` declarations. It is retained but superseded.
  `20260826T093447237Z-incomplete` preserves the focused rewritten staging test.
- The final full gate passed at
  `artifacts/solid-feature-qualification/runs/20260826T094412Z-solid-feature-sprint-1-r3`.
  All 25 commands returned zero; application tests passed 212/212, worker tests
  13/13, parity self-tests 7/7, non-parity self-tests 6/6, native/release-WASM
  parity 15/15, and production browser 5/5.
- Rectangle preview p50/p95 was 3.9/7.1 ms and recompute was 12.8/19.6 ms;
  annulus preview was 6.7/9.9 ms and recompute was 18.4/36.8 ms. Cancellation
  stayed below 7.8 ms, both workloads recorded zero main-thread long tasks, and
  memory growth stayed below 13.4 MiB.
- Automated qualification is complete. Sprint completion remains pending until
  the fresh independent revision 3 audit reports zero findings.

### 2026-08-26 — Independent audit rejected revision 3; revision 4 opened

- The fresh independent review accepted the revision 3 source binding, bundle
  isolation, checksums, record links, locked inputs/WASM, legacy workflows,
  upstream recompute, and nonempty identity evidence. It reported one remaining
  issue: E3D-S1-11 explicitly requires compatible selected-region replacement
  during timeline edit, while the revision 3 production browser evidence covered
  tool-first creation, selection-first creation, and distance-only timeline edit.
- The automated revision 3 pass is therefore rejected as sprint qualification.
  Its exact immutable bundle remains at
  `artifacts/solid-feature-qualification/runs/20260826T094412Z-solid-feature-sprint-1-r3`
  as superseded historical evidence; none of its hashes, counts, or passing
  results are represented as revision 4 evidence.
- Revision 4 remediation is in progress and the sprint is not qualified. Its
  production workflow must use a distinct compatible replacement region in the
  stored source sketch/support and
  prove both cancel and commit paths, original/replacement references, retained
  feature/body identity, expected geometry, recompute, and save/reload behavior.
- Completion requires a new content-bound revision 4 full-gate bundle followed
  by a fresh independent review with zero issues. No acceptance criterion or
  deferred-scope boundary is changed by this remediation.

### 2026-08-26 — Automated revision 4 qualification passed

- Revision 4 implemented the same-sketch selected-replacement browser workflow.
  Its cancel, commit, recompute, and reload assertions all passed; original and
  replacement references, retained feature/body identity, expected geometry,
  and worker invocation counts `[1, 1, 1]` are bound into the evidence.
- The complete gate passed at
  `artifacts/solid-feature-qualification/runs/20260826T105732Z-solid-feature-sprint-1-r4`.
  All 25 commands returned zero; application tests passed 213/213, worker tests
  13/13, native/release-WASM parity 15/15, comparator self-tests 7/7,
  non-parity self-tests 6/6, and production browser tests 5/5. The bundle contains
  55 records and 169 checksummed files.
- The qualifying source snapshot is
  `7987b8ad719d582fe93d37d0138f8e4b05d15a930d7428c30fa6c08c81bd4d05`
  for 557 Git-visible entries/files and 0 deletions. It binds manifest SHA-256
  `a6cbb9e925a4f4d34804209c5ffdfa4999fae75cb4e4a70ff7ce7b0becc47afc`,
  build `solid-feature-sprint-1-r4-20260826`, and release-WASM SHA-256
  `c1f57b5e4f946b4ed3cf3aad4fc6f039d1cd53cd5b370b6015c7a16f9274746f`.
- Rectangle preview p50/p95 was 4.4/5.5 ms, recompute was 13.6/16.3 ms,
  cancellation max was 2.9 ms, and memory growth was 13,156,436 bytes. Annulus
  preview was 7.0/16.5 ms, recompute was 18.9/37.2 ms, cancellation max was
  4.7 ms, and memory growth was 13,334,024 bytes. Both workloads recorded zero
  main-thread long tasks.
- The first revision 4 attempt archived prior staging as
  `20260826T103730152Z-incomplete`. The next run,
  `20260826T105034701Z-incomplete`, failed closed after the build because the
  required native/release-WASM exporter arguments were omitted. The final run
  supplied the required arguments and passed; neither incomplete attempt is
  discarded or represented as qualifying evidence.
- Automated revision 4 qualification is complete. Sprint completion remains
  pending until a fresh independent revision 4 review reports zero issues,
  including review of the four documentation-only completion-ledger changes.

### 2026-08-26 — Independent audit rejected revision 4; revision 5 opened

- The fresh revision 4 audit accepted the prior source binding, bundle
  portability, selected same-sketch replacement, compatibility, parity,
  production browser, and performance evidence, but reported one P1 issue.
- A selected profile from another sketch/support could enter timeline
  replacement despite the explicit deferred cross-sketch boundary. Therefore the
  revision 4 automated pass is retained only as historical evidence at
  `artifacts/solid-feature-qualification/runs/20260826T105732Z-solid-feature-sprint-1-r4`.
- Revision 5 requires an exact source sketch-ID match and two `ready`, equal
  resolved plane frames. An incompatible selection blocks with an explicit
  source-sketch/resolved-support reason before preview or commit. Cross-sketch
  replacement and support rebinding remain deferred.

### 2026-08-26 — Automated revision 5 qualification passed

- The complete gate passed at
  `artifacts/solid-feature-qualification/runs/20260826T115242Z-solid-feature-sprint-1-r5`.
  All 25 commands returned zero; application tests passed 214/214, worker tests
  13/13, native/release-WASM parity 15/15, comparator self-tests 7/7,
  non-parity self-tests 6/6, and production browser tests 6/6 across all four
  manifest IDs. The isolated validator passed all 55 records and 169 final
  checksummed files.
- The cross-sketch browser attempt recorded an explicit blocked Edit Extrude
  state, zero preview and commit dispatches, and unchanged accepted hash,
  source sketch/support/region references, feature/body IDs, geometry bounds,
  and feature count through recompute and reload.
- The qualifying source snapshot is
  `d3b7a13708685e4dc3968f71f392d36c82f004a90705f8b726e3b827381f3260`
  for 557 tracked/nonignored entries, 557 files, and 0 deletions. It binds commit
  `3f2ec88b4687c15cd8721f840ed21b293955f95e`, manifest SHA-256
  `f0bd46340f256a7f8624738b9d5cf07ae6b952dd2a4b79c25830345866d5f80b`,
  build `solid-feature-sprint-1-r5-20260826`, and release-WASM SHA-256
  `c1f57b5e4f946b4ed3cf3aad4fc6f039d1cd53cd5b370b6015c7a16f9274746f`.
- Rectangle preview p50/p95 was 4.1/6.4 ms, recompute was 12.4/16.6 ms,
  cancellation max was 2.099999905 ms, memory growth was 13,163,512 bytes, and
  main-thread long tasks were zero. Annulus preview was 7.1/12.4 ms, recompute
  was 18.6/29.1 ms, cancellation max was 5.299999952 ms, memory growth was
  13,346,664 bytes, and main-thread long tasks were zero.
- `20260826T113950109Z-incomplete` retains the staging state archived at the
  revision 5 qualification start; it is not discarded or qualifying evidence.
- Automated revision 5 qualification is complete. Sprint completion remains
  pending until a fresh independent revision 5 review reports zero issues,
  including review of the four documentation-only completion-ledger changes.

### 2026-08-26 — Independent revision 5 review satisfied completion gate

- The fresh independent reviewer checked the immutable revision 5 source and
  bundle, portable links and checksums, manifest-owned records, runtime lock,
  legacy and migration evidence, native/release-WASM parity, production browser
  workflows, performance results, and the four documentation-only completion
  ledger deltas.
- The reviewer confirmed the same-source sketch/resolved-frame boundary and the
  fail-closed cross-sketch workflow: explicit blocked reason, zero preview/commit
  dispatches, and unchanged accepted hash, references, feature/body IDs, bounds,
  and feature count through recompute and reload.
- **Finding count: zero. Completion gate: satisfied.** Revision 5 and its nine
  candidate stories are `QUALIFIED`. All deferred and non-candidate scope remains
  deferred and is not included in this completion decision.
