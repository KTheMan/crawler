# Planar-Face Extrude and Explicit Support Repair — Sprint 4

- Status: **QUALIFIED**
- Completion gates: **ALL CLOSED — NO REQUIRED WORK REMAINS FOR THE BOUNDED SCOPE**
- Planning date: 2026-08-28
- Candidate: `solid-feature-sprint-4`, revision 1
- Sprint goal: qualify blind New Body Extrude from a current planar face, including bounded explicit repair to a compatible face on the same body, producer, and component
- Parent initiative: [Solid Feature Modernization Initiative Backlog](solid-feature-modernization-initiative.md)
- Qualified baseline: [Offset Construction-Plane Extrude — Sprint 3](solid-feature-modernization-sprint-3.md)
- Qualification ledger: [Solid Feature Sprint 4 Qualification](../qualification/solid-feature-sprint-4-qualification.md)
- Frozen candidate: `contracts/solid-feature-candidate/sprint-4.json`

## 1. Outcome and frozen boundary

Sprint 4 adds one bounded placement path to the qualified Extrude foundation: a
sketch whose support is a current analytic planar face on an accepted body may
drive Blind New Body Extrude. The support is a durable topology reference, but
the exact working frame must come from current native runtime topology authority
for the accepted body and revision. Renderer packets, cached centroids, stable
tokens, and fallback signatures are never independent geometry authority.

The qualified Sprint 1–3 profile and Extrude boundary remains unchanged:

- exact line, circular-arc, and circle regions, including qualified holes;
- Blind extent only;
- Forward, Reverse, and Symmetric direction modes;
- New Body result only; and
- deterministic preview, commit, edit, recompute, undo/redo, save/reopen, native
  execution, generated release WASM, and production-worker behavior.

The repair boundary is intentionally narrower than general support rebinding. A
missing planar-face support may be explicitly rebound only to a current,
analytic planar face owned by the same body, producer feature, and component.
Candidate ranking may use the stored topology kind and fallback signature, but
no candidate is selected or committed automatically. Preview must prove the
recovered frame and downstream result before one atomic repair transaction is
accepted.

## 2. Why this is the next bounded slice

Sprint 1 qualified origin-plane Extrude and Sprint 3 qualified signed
origin-relative offset-plane Extrude. Initiative Gate B still requires a
planar-face create/edit/recompute/reload/repair workflow before the foundational
Extrude/Cut vertical slice can advance. Planar-face placement is therefore a
smaller and more dependency-correct step than pulling forward Boolean result
modes, termination extents, or a new Revolve/Sweep/Loft operation family.

At sprint selection, the repository already had durable topology references,
viewport face picking, body-qualified current planar-face observations,
deterministic graph recompute, and explicit repair-candidate helpers, while the
Exact Extrude runtime still rejected topology-backed sketches. Sprint 4 was
selected to connect those layers under native/release-WASM authority rather than
promoting renderer evidence or a test-only frame substitute.

## 3. Conditional native-authority gate

Implementation beyond contracts and bounded probes is conditional on proving
that the native runtime and generated release WASM can provide current planar
face authority with all of the following:

1. body, producer feature, component, topology kind, and stable kernel identity;
2. an analytic-planar classification;
3. an exact deterministic origin, orthonormal X/Y axes, normal, handedness, and
   unit scale;
4. a polarity rule that is stable across native/WASM and save/reopen; and
5. identity behavior across an upstream dimension edit that preserves topology.

If this authority cannot be produced, Sprint 4 remains blocked at the gate. The
implementation must not substitute packet-derived centroid/normal data, a
fallback signature, a sampled polygon, or a reserved token. A blocked gate is
documented in the append-only qualification ledger and does not permit partial
qualification.

## 4. Story ledger

| Story | Final state | Required outcome |
|---|---|---|
| E3D-S4-01 | Automated passed; findings closed | Attempt 34 closes every persisted-ID path; Attempt 38 aligns the native evidence sentinel; Attempt 40 passes the complete source-bound gate and native/release-WASM parity 10/10 |
| E3D-S4-02 | Automated passed; finding closed | Exact nanometer local/world inverse round trips execute for top, bottom, and orthogonal side faces in native and release WASM |
| E3D-S4-03 | Automated passed; findings closed | Planar circle/annulus-with-hole execution and independent frozen geometry oracles pass in all ten native/WASM fixtures |
| E3D-S4-04 | Automated passed; findings closed | Every body/producer/component mismatch variant executes and eight unobscured qualitative screenshots pass with the production lifecycle |
| E3D-S4-05 | Qualified; all gates closed | Attempt 40 supplies the complete immutable no-waiver bundle; Attempt 41 returned exact standalone `ZERO FINDINGS`; Attempt 42's final documentation-only re-review also returned exact standalone `ZERO FINDINGS` |

## 5. Stories and acceptance criteria

### E3D-S4-01 — Define durable current planar-face support authority

**Story:** As a feature developer, I need a planar-face sketch support to retain
stable design intent without treating cached display data as model authority.

**Acceptance criteria:**

1. A versioned planar support reference names the topology reference, body,
   producer feature, component, face kind, stable kernel identity, and stable
   token needed for persistence and diagnostics.
2. Stored fallback signature data is used only to rank explicit repair
   candidates. It never authorizes a working frame or an automatic rebind.
3. Current authority is tied to the accepted body and document revision. Stale,
   wrong-body, wrong-producer, wrong-component, missing, or non-face evidence is
   rejected with a stable field path and referenced IDs.
4. Native `u64` and protocol string topology identities round-trip canonically,
   including values outside JavaScript's exact integer range.
5. A saved document with an unresolved support opens in structured repair state
   without accepting an invalid runtime or mutating the last valid body.
6. Unknown schema versions and malformed topology references fail closed.

**Required evidence:** schema/round-trip fixtures, identity-bound native and
TypeScript tests, load/reopen repair-state coverage, and negative wrong-body,
wrong-producer, wrong-component, and stale-revision cases.

### E3D-S4-02 — Resolve the exact planar-face frame fail closed

**Story:** As a modeler, I need a face-attached sketch to have the same exact
world placement in native and release WASM so upstream edits do not silently
move or flip downstream geometry.

**Acceptance criteria:**

1. Native topology authority returns analytic planarity plus exact frame origin,
   X/Y axes, normal, handedness, and scale for the current accepted face.
2. The origin and axis convention is documented and deterministic. An upstream
   identity-preserving size edit produces the contractually expected frame
   update without an unexplained 180-degree axis or normal flip.
3. Local-to-world and world-to-local transforms round-trip exact nanometer test
   points on top, bottom, and orthogonal side faces.
4. Native and generated release WASM emit byte-equivalent normalized frame and
   diagnostic categories for every declared fixture.
5. Missing current authority, stale identity, nonplanarity, degenerate axes,
   suppressed producer, and cross-component references fail before preview or
   commit and preserve accepted document/body/packet/hash state.
6. The resolved frame comes from runtime authority, not renderer or descriptor
   assertions copied into evidence.

**Required evidence:** native authority probe, release-WASM authority probe,
orientation matrix, upstream-edit fixture, negative authority fixtures, and
zero-difference parity.

### E3D-S4-03 — Execute Blind New Body Extrude from a planar face

**Story:** As a modeler, I need a qualified sketch on a planar face to create an
editable New Body Extrude using the same behavior already qualified on origin
and offset planes.

**Acceptance criteria:**

1. Qualified line/arc/circle regions and holes execute from the exact face frame
   with Blind and New Body semantics.
2. Forward, Reverse, and Symmetric directions use the qualified distance/total-
   length rules and face-frame polarity.
3. Exact AABB, centroid, signed volume, surface area, orientation, analytic
   classification, body count, and canonical document hash match fixture oracles.
4. The upstream support body remains semantically unchanged because this sprint
   does not perform Join, Cut, or Intersect.
5. Feature/body/sketch/profile identities remain stable through distance and
   upstream identity-preserving edits; only the support closure and descendants
   become dirty.
6. Preview and commit use the same normalized operation definition and failed
   execution is atomic.

**Required evidence:** orientation/direction matrix, region-with-hole case,
upstream recompute, create/edit equivalence, native/WASM oracles, and parity.

### E3D-S4-04 — Complete production lifecycle and bounded explicit repair

**Story:** As a modeler, I need face selection, editing, persistence, and repair
to work through the production generated worker without hidden topology healing.

**Acceptance criteria:**

1. Tool-first and selection-first workflows normalize the same typed face
   support, sketch/profile geometry IDs, direction, distance, transaction, and
   base-revision fields; newly allocated IDs may differ only with matching types.
2. Only current selectable analytic planar faces are accepted. Hidden,
   suppressed, stale, curved, foreign-body, foreign-producer, or
   foreign-component faces are refused with an actionable diagnostic.
3. Create, preview/cancel, commit, timeline edit, upstream recompute,
   suppress/unsuppress, undo/redo, save/reopen, and explicit recompute retain
   stable design intent and selection behavior.
4. A broken support blocks downstream preview/recompute with a repair diagnostic
   while the last accepted document, upstream body, downstream body, renderer
   packet, and semantic hash remain unchanged.
5. Repair candidates are deterministically ranked but never silently selected.
   The chosen replacement must be a current planar face on the same body,
   producer, and component.
6. Repair preview evaluates the actual replacement frame and downstream result.
   Commit is one transaction, undoable/redoable, persists across reopen, and
   recovers descendants without replacing unaffected identities.
7. The production browser uses the generated release WASM and the real model
   worker; UI-only injected success objects are not evidence.

**Required evidence:** generated-worker create/edit lifecycle, broken/repaired
support workflow, ambiguous-candidate refusal, selection clearing, save/reopen,
screenshots, JUnit, and performance measurements.

### E3D-S4-05 — Qualify the Sprint 4 planar-face slice without waivers

**Story:** As the product owner, I need one repeatable gate proving the exact
frozen Sprint 4 boundary before any qualified claim is made.

**Acceptance criteria:**

1. The manifest, source snapshot, fixture descriptors, test identities, runtime
   build ID, generated WASM hash, and all required artifacts are content-bound.
2. Every declared parity fixture has passing native and release-WASM evidence
   produced by actual executed lifecycle operations.
3. Candidate/schema negative tests, comparator and non-parity self-tests,
   complete workspace tests, zero-warning lint, deterministic generation,
   production build, production browser, locked performance, evidence
   completeness, checksums, and isolated bundle validation all pass.
4. Candidate waivers are forbidden. Non-candidate observations remain
   separately owned and cannot replace candidate evidence.
5. QualificationReady validation is impossible while the native-authority gate,
   any required fixture/test/artifact, runtime lock, or performance workload is
   pending.
6. After the automated bundle passes, an independent exact-state audit of
   source, contracts, tests, bundle, and documents must return ZERO FINDINGS.

**Required evidence:** immutable qualification bundle, complete gate log,
qualification report, evidence checksums, and independent review entry.

## 6. Frozen fixture matrix

| Fixture | Parity | Required proof |
|---|---:|---|
| `extrude-planar-face-orientation-matrix` | Yes | Top/bottom/orthogonal side faces × Forward/Reverse/Symmetric exact frame and geometry |
| `extrude-planar-face-upstream-edit` | Yes | Identity-preserving upstream dimension edit updates only the support closure and descendants |
| `extrude-planar-face-save-reopen-edit` | Yes | Round-trip, distance/direction edit, suppress/undo/redo, and deterministic recompute |
| `planar-face-missing-reference` | Yes | Missing topology reference is field-addressed and atomic |
| `planar-face-stale-current-evidence` | Yes | Packet/runtime revision or stable-identity mismatch cannot authorize a frame |
| `planar-face-nonplanar-reference` | Yes | Curved or nonanalytic support is rejected before preview/commit |
| `planar-face-suppressed-producer` | Yes | Suppressed upstream producer blocks descendants while accepted state remains unchanged |
| `planar-face-wrong-body-producer-component` | Yes | Same-looking foreign authority is rejected with exact referenced IDs |
| `planar-face-broken-support-explicit-repair` | Yes | Candidate ranking, explicit compatible repair preview/commit, undo/redo, and reopen |
| `planar-face-ambiguous-repair-refused` | Yes | Equal/ambiguous candidates never auto-apply and preserve accepted state |
| `production-planar-face-lifecycle` | No | Production generated-worker selection/create/edit/recompute/reload/repair interaction |

All eleven fixture descriptors exist and passed candidate validation. The ten
parity fixtures each have executed native and generated release-WASM records in
`runtime/native`, `runtime/release-wasm`, and `records`; the production fixture
has executed generated-worker browser evidence in `fixtures`, `browser`, and
`records`. The immutable run contains ten native fixture files, ten release-WASM
fixture files, eight browser screenshots, two passing browser JUnit tests, and
ten passing native/WASM fixture comparisons represented by ten passing
testcases in one parity JUnit testsuite.

## 7. Required tests, artifacts, and performance

The candidate follows the established Sprint 3 gate shape: schema validation,
native contracts/oracles, document and storage mirrors, release-WASM execution,
application units, native/WASM parity, production browser, performance,
completeness validation, checksums, and isolated bundle validation. The final
runtime lock is build
`solid-feature-sprint-4-r1-20260828`, generated release-WASM SHA-256
`0e1f3cb3b3c1605df02ee34e87546563ee199a3678bb7d7b6b3c810cf5e9cd89`
(10,893,016 bytes), feature-kernel SHA-256
`c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`,
and operation-catalog SHA-256
`ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`.

Two new locked performance workloads are required:

- `extrude-planar-face-rectangle`: preview, commit/edit recompute, cancellation,
  Long Task maximum, and observed heap growth for the normal lifecycle; and
- `planar-face-support-repair`: missing-support diagnosis, candidate collection,
  actual repair preview, commit/recompute, cancellation, Long Task maximum, and
  observed heap growth.

Both workload IDs are locked and passed in the final production browser with
zero budget violations. `extrude-planar-face-rectangle` ran 2 warmups, 10
measured iterations, and 50 cancellation cycles: preview p50/p95
48.200000047683716/54.700000047683716 ms, recompute p50/p95 18/21.1 ms,
cancellation maximum 51.89999985694885 ms, zero Long Tasks, and +1,363,204 bytes observed
heap growth. `planar-face-support-repair` ran 2/10/50: preview p50/p95
63.299999952316284/118.90000009536743 ms, recompute p50/p95
128.5/231.70000004768372 ms, cancellation maximum
42.700000047683716 ms, zero Long Tasks, +866,640 bytes
observed heap growth, one candidate, and 62 ranking observations.
Sprint 1–3 workload thresholds were not weakened.

## 8. Explicit exclusions and deferrals

The following remain outside Sprint 4 and unqualified:

- arbitrary, angled, tangent, three-point, and face-derived datum planes;
- curved or nonanalytic supports, including cylindrical, conical, and freeform
  faces;
- automatic topology healing, split/merge naming, and topology-changing rebind;
- cross-component support, cross-support profile replacement, and generalized
  support rebinding beyond explicit compatible planar-face-to-planar-face repair
  on the same body, producer, and component;
- two-side, start-offset, Through All, To Next, To Object, and other target
  extents;
- Join, Cut, Intersect, target-body scope, Boolean targets, and participant
  selection;
- model-space handles, draft/taper, and thin Extrude; and
- Revolve, Sweep, and Loft.

No disabled control, reserved token, renderer-only frame, fallback polygon,
fixture-only branch, or copied lifecycle assertion may represent a deferred
capability as complete.

## 9. Documentation and completion policy

The qualification ledger is append-only. Failed probes, incomplete attempts,
independent findings, remediation, focused checks, full automated runs, and
deferred work remain visible. Status may advance only from scope frozen, to
implementation complete, to automated qualification passed, to qualified after
an independent ZERO FINDINGS review. A focused pass never substitutes for the
complete source-bound gate.

## 10. Automated qualification completion checkpoint

The source-bound no-waiver gate passed on the immutable run
`artifacts/solid-feature-qualification/runs/20260829T052403Z-solid-feature-sprint-4-r1`.
The bundle binds candidate manifest SHA-256
`ecd6510e8569a35053bd5b9f410714aa637a4e6201325bb2bc3d68fdff37a99c`, Git
commit `3f2ec88b4687c15cd8721f840ed21b293955f95e`, and dirty/source-snapshot
content SHA-256
`0362eb903651f4bc53c34981275ba319064e2c69d97e40dfa037ad5abfba99a1`
under `sha256-git-visible-path-content-v1` across 853 entries/files with zero
deleted paths. All 25 required commands passed. The sealed isolated bundle has
35 qualification records and 160 checksummed files.

The run used Rust/Cargo 1.94.0, Node 22.23.1, pnpm 11.19.0, and PowerShell
7.6.4 on Windows 10.0.22621 x64 with 8 logical CPUs and 68,550,533,120 bytes of
memory. The production browser was Chrome 151.0.7922.109, headless at 1440×900,
device-pixel ratio 1, one worker, port 4186. Browser JUnit passed 2/2 with zero
failures, errors, or skips; native/WASM parity passed 10/10 fixture comparisons and its one aggregate JUnit test; both
performance workloads reported zero violations.

This checkpoint proves the automated gate only. Final qualification remains
pending until an independent reviewer audits the exact final source, contracts,
tests, repeatable harnesses, immutable bundle, and documentation and returns
`ZERO FINDINGS`. The exclusions and deferrals in Section 8 remain unchanged.

## 11. Independent-review rejection and remediation gate

The mandatory independent review of the Attempt 14 state did not return zero
findings. It rejected the initial bundle for nine documented issues: missing
planar circle/annulus-with-hole execution; missing exact nanometer inverse-frame
round trips; a persisted topology reference without its own version and
component field; incomplete execution of the declared body/producer/component
mismatch matrix; incomplete independent expected geometry oracles; unbound
exporter command provenance; inaccurate candidate test-to-command mappings;
three screenshots obscured by the Quick Tour overlay; and stale baseline wording.

The Attempt 14 run remains immutable historical evidence, not a qualified
result. Sprint 4 must remain open until every finding is remediated, a fresh
complete source-bound automated gate and isolated-bundle validation pass, the
completion documents are reconciled, and a fresh independent exact-state review
returns `ZERO FINDINGS`. Section 8 exclusions and deferrals remain unchanged.

## 12. Remediated automated qualification checkpoint

Attempts 16–19 closed all nine Attempt 15 findings and every subsequent
fail-closed gate discovery without a waiver. The fresh source-bound gate passed
on immutable run
`artifacts/solid-feature-qualification/runs/20260829T075140Z-solid-feature-sprint-4-r1`.
It binds candidate manifest SHA-256
`62fba43c91f1f86855115ca2902a99a484d14620efd7d246e611bdd0198b7101`, Git
commit `3f2ec88b4687c15cd8721f840ed21b293955f95e`, and source content SHA-256
`d52a23d001969b578a140ad5aa822c7b47697888dbd9d10a19eb6e1da407e275`
under `sha256-git-visible-path-content-v1` across 870 entries/files with zero
deleted paths. All 27 required commands passed, including the new
command-provenance self-test and focused native planar-face contracts command.
The sealed isolated bundle contains 35 qualification records and 162
checksummed files.

The remediated runtime lock is build `solid-feature-sprint-4-r1-20260828` and
generated release-WASM SHA-256
`5408367275d3eabe9781321959bd8da0c4c0443c15ab5d38c4a67bc59a9b6458`
(10,895,809 bytes). The feature-kernel and operation-catalog hashes remain
`c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`
and `ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`.
The run contains ten executed native fixtures, ten executed release-WASM
fixtures, 10/10 zero-difference parity comparisons, 2/2 production-browser
tests, and eight unobscured screenshots. Both locked performance workloads
completed their 2 warmups, 10 measured iterations, and 50 cancellation cycles
with zero violations and zero Long Tasks.

The exact structured rerun recorded in `run-metadata.json` is:

```powershell
pwsh -NoProfile -File scripts/qualify-solid-features.ps1 -Manifest contracts/solid-feature-candidate/sprint-4.json -NativeEvidenceCommand 'cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/native' -WasmEvidenceCommand 'node scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/release-wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm'
```

This checkpoint advances Sprint 4 only to **AUTOMATED QUALIFICATION PASSED —
INDEPENDENT EXACT-STATE REVIEW PENDING**. It does not override the mandatory
independent `ZERO FINDINGS` gate. Section 8 exclusions and deferrals remain
unchanged and unqualified.

## 13. Attempt 21 rejection and post-P1 remediation

The independent review of the Section 12 state did not return zero findings.
It confirmed closure of the nine earlier findings, but found one remaining P1
cross-language persistence mismatch. The TypeScript document codec accepted
`stable_kernel_id` value `18446744073709551616`, one above `u64::MAX`, even
though Rust rejected it. It also accepted an empty or malformed
`fallback_signature` and then omitted that invalid value during serialization.
The Section 12 run remains immutable historical automated evidence and is
rejected for final qualification.

The remediation makes TypeScript document and storage persistence match the
Rust boundary exactly. Kernel IDs must be canonical unsigned decimal text with
an exact `BigInt` value at most `18446744073709551615`. Fallback signatures must
use an exact Rust-compatible variant, exact keys, three-element signed safe-
integer tuples, and nonnegative safe-integer evidence fields. Parse and
serialization both fail closed; invalid data is not silently dropped. Focused
verification passed 8/8 document-protocol tests, 16/16 storage-protocol tests,
43/43 application protocol tests, TypeScript compilation, and generated-binding
difference checks. The complete gate then repeated the document mirror at 8/8
and the application unit suite at 237/237.

This closes the Attempt 21 finding at the implementation and automated-evidence
stage only. It does not satisfy the independent-review acceptance criterion.

## 14. Post-P1 automated qualification checkpoint

The fresh source-bound, no-waiver gate passed on immutable run
`artifacts/solid-feature-qualification/runs/20260829T084448Z-solid-feature-sprint-4-r1`.
It binds candidate manifest SHA-256
`62fba43c91f1f86855115ca2902a99a484d14620efd7d246e611bdd0198b7101`, Git
commit `3f2ec88b4687c15cd8721f840ed21b293955f95e`, and post-P1 source content
SHA-256 `221cc11345563bc61e7793d01a456d559b670f2fec6734473338ffbdfc3b81e6`
under `sha256-git-visible-path-content-v1` across 870 entries/files with zero
deleted paths. All 27 required commands passed. The sealed isolated bundle has
35 qualification records and 162 checksum entries covering every bundle file
other than `SHA256SUMS.json`.

The runtime lock remains build `solid-feature-sprint-4-r1-20260828` and
generated release-WASM SHA-256
`5408367275d3eabe9781321959bd8da0c4c0443c15ab5d38c4a67bc59a9b6458`
(10,895,809 bytes). The feature-kernel and operation-catalog hashes remain
`c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`
and `ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`.
The run contains ten executed native fixtures, ten executed release-WASM
fixtures, 10/10 zero-difference parity comparisons, 2/2 production-browser
tests with zero failures/errors/skips, and eight unobscured screenshots. Both
locked workloads completed 2 warmups, 10 measured iterations, and 50
cancellation cycles with zero violations and zero Long Tasks; their exact
post-P1 observations are recorded in Section 7.

The exact structured rerun in `run-metadata.json`, invocation SHA-256
`5bc7b97d18a1e981aa0d6048b891685cd4b20d09ba33242b1aa946d4a0f1e174`,
is:

```powershell
pwsh -NoProfile -File scripts/qualify-solid-features.ps1 -Manifest contracts/solid-feature-candidate/sprint-4.json -NativeEvidenceCommand 'cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/native' -WasmEvidenceCommand 'node scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/release-wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm'
```

The current state is **AUTOMATED QUALIFICATION PASSED — INDEPENDENT EXACT-STATE
REVIEW PENDING**, not qualified. The mandatory independent reviewer must return
`ZERO FINDINGS` against this exact source, contracts, tests, repeatable harness,
bundle, and reconciled documentation. Every exclusion and deferral in Section 8
remains unchanged and unqualified.

Earlier historical checkpoints used the shorthand “one aggregate parity JUnit
test.” The exact artifact is one JUnit `testsuite` containing ten passing
`testcase` entries, one per compared fixture. This wording correction does not
alter the historical runs or their pass/fail outcomes.

## 15. Attempt 24 independent rejection and required remediation

The independent exact-state review of immutable run
`artifacts/solid-feature-qualification/runs/20260829T084448Z-solid-feature-sprint-4-r1`
did not return `ZERO FINDINGS`. It found one P1 persistence mismatch in
`crates/crawler-document/src/lib.rs`: Rust's `decimal_u64` deserializer accepted
noncanonical decimal kernel identities that the TypeScript document and storage
boundaries rejected, and the Rust `TopologySignature` representation accepted
undeclared fallback-signature keys instead of failing closed. The run's 27/27
automated result remains immutable historical evidence, but it is rejected for
final qualification because the persisted topology-reference domain was not
identical across Rust, TypeScript, and storage for malformed inputs.

E3D-S4-01 is therefore reopened at P1 and remediation is in progress. Rust must
enforce canonical unsigned decimal-string kernel identities within `u64` and
exact variant-specific fallback-signature keys, with positive boundary and
negative malformed-input regression tests. After that source change, Sprint 4
requires a fresh complete source-bound no-waiver gate, a new isolated immutable
bundle, reconciled documentation, and a new independent review of that exact
state returning `ZERO FINDINGS`. No remediation or pass is claimed here. The
included scope remains frozen, and every exclusion and deferral in Section 8
remains unchanged and unqualified.

## 16. Post-review administrative quarantine records

Two post-review `-incomplete` directories do not represent new product runs.
`20260829T090357721Z-incomplete` is a quarantined copy whose metadata still
identifies immutable Attempt 23 run `20260829T084448Z-solid-feature-sprint-4-r1`
and its exact 27-command/35-record/162-checksum-entry source state.
`20260829T090726258Z-incomplete` contains only an empty checksum document, with
zero files and no metadata or command ledger. They are retained to keep the
record complete, but neither is a pass, failure, or substitute for a rerun.

## 17. First Rust-remediation rerun rejected by legacy numeric fixture

The Attempt 24 remediation changed Rust topology identities to serialize as
canonical decimal strings and deserialize only from canonical unsigned decimal
strings within `u64`. Numeric, signed, padded, empty, whitespace, and out-of-
range values fail closed. `TopologySignature` now denies unknown fields, and
positive `0`/`u64::MAX` plus malformed identity/signature regressions exercise
the exact cross-language boundary.

Run `20260829T091925257Z-incomplete`, source SHA-256
`f31669710c62e2a07449a35c5fa6782b81f29218bde0e73db869ce586e9133c8`
across 870 entries/files, stopped at `native-workspace` after four earlier
commands passed. A legacy part-engine fixture still stored kernel ID `6` as a
JSON number, producing `invalid type: integer '6', expected a string`. The run
has five command records and eight checksum entries and is rejected.

## 18. Second Rust-remediation rerun rejected by runtime numeric fixture

After the first fixture migration, run
`20260829T093532180Z-incomplete`, source SHA-256
`e0cc428b51c91a3ecb42a13e5fdd9f4c0456e263cef948b1a97933297cb3cf1a`
across 870 entries/files, again stopped at `native-workspace` after four prior
passes. The durable topology-face repair runtime test still supplied numeric
`18446744073709551615`, which strict Rust rejected as expected after 72 other
runtime tests passed. This five-command/eight-checksum-entry state is rejected;
the runtime test-built persistence path required migration too.

## 19. Generation-complete but unfinished rerun

Run `20260829T100522087Z-incomplete`, source SHA-256
`fe203572173ca0725017328427d36e7a8df7bde5c104e9b86c4fb3aeb5ad3106`
across 870 entries/files, records 17/17 passing commands through the second
deterministic generation pass. It includes clean native workspace, focused
native contracts, lint, all WASM compile checks, 8/8 document mirror, the newly
explicit 16/16 storage mirror, operation mirror, and both generation passes.
No command failure is recorded, so the bundle does not prove why execution
ended. It remains incomplete because application, evidence, parity, browser,
performance, indexing, reporting, and bundle-integrity gates are absent. It has
20 checksum entries and makes no qualification claim.

## 20. Release-WASM evidence rerun rejected

Run `20260829T102229191Z-incomplete`, source SHA-256
`29c3d4380eca3e786649d4d227b34aeb8961458250e775b770c99285ba05d7e6`
across 870 entries/files, passed 23 commands before `wasm-evidence` failed with
exit 1. Native workspace/evidence, mirrors, deterministic generation, 237/237
application units, worker/parity self-tests, and the production build had
passed. All ten release-WASM fixtures then returned structured exporter
failures; the representative case reported `document serialization failed:
invalid type: integer '26', expected a string at line 1 column 697` while
accepted state remained unchanged. The 24-command/47-checksum-entry run has no
passing WASM evidence, parity, browser/performance, report, or final bundle and
is rejected. The generated-runtime bridge required canonical string identity
serialization and regeneration.

## 21. Final post-Attempt-24 automated qualification checkpoint

The fully aligned source-bound, no-waiver gate passed on immutable run
`artifacts/solid-feature-qualification/runs/20260829T103331Z-solid-feature-sprint-4-r1`.
It binds candidate manifest SHA-256
`2dd9a81be451d011792eb46ac86275da092f16a20302f14e17c5de4433e16f79`, Git
commit `3f2ec88b4687c15cd8721f840ed21b293955f95e`, and source content SHA-256
`419dd8c4d9baa4f386b6cbebc0c406935e1a88f3c009780879304ad4a84b0a96`
under `sha256-git-visible-path-content-v1` across 870 entries/files with zero
deleted paths. All 28 commands passed, now including the explicit
provenance-bound storage mirror. Document mirror passed 8/8, storage mirror
16/16, application units 237/237, and focused native contracts 5/5.

The locked build remains `solid-feature-sprint-4-r1-20260828`; generated
release-WASM SHA-256 is
`c8932ce766f9dd9e2e5e27f1fee8ad4fc462b21c3754297c66621cdd0b130c58`
(10,887,489 bytes). Feature-kernel SHA-256 is
`c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`
(4,995,660 bytes), and operation-catalog SHA-256 is
`ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`
(38,721 bytes). The isolated run contains 35 qualification records and 163
checksum entries covering every file other than `SHA256SUMS.json`; the in-step
validator logged the pre-final-ledger set as 35 records and 162 checksummed
files.

Ten native and ten generated release-WASM fixtures passed with 10/10
zero-difference parity testcases. Production browser JUnit passed 2/2 with zero
failures/errors/skips, and all eight screenshots are unobscured. Both locked
performance workloads completed 2 warmups, 10 measured iterations, and 50
cancellation cycles with zero violations and zero Long Tasks; their exact final
observations are recorded in Section 7.

The exact structured rerun has invocation SHA-256
`5bc7b97d18a1e981aa0d6048b891685cd4b20d09ba33242b1aa946d4a0f1e174`:

```powershell
pwsh -NoProfile -File scripts/qualify-solid-features.ps1 -Manifest contracts/solid-feature-candidate/sprint-4.json -NativeEvidenceCommand 'cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/native' -WasmEvidenceCommand 'node scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/release-wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm'
```

The current state is **AUTOMATED PASS — INDEPENDENT REVIEW PENDING** (not
qualified). Attempt 24's P1 is closed only at the automated-evidence stage.
Qualification still requires an independent exact-state audit of this final
source, contracts, tests, repeatable harness, immutable bundle, and reconciled
documents returning `ZERO FINDINGS`. Every exclusion and deferral in Section 8
remains unchanged and unqualified.

## 22. Attempt 31 independent rejection and partial remediation

The independent exact-state audit of immutable Attempt 30 run
`artifacts/solid-feature-qualification/runs/20260829T103331Z-solid-feature-sprint-4-r1`
did not return `ZERO FINDINGS`. It found one P1 cross-language persistence
mismatch for the persisted sketch-element variant `external_line`.

Rust already applied strict `decimal_u64` serialization/deserialization to
`SketchElement::ExternalLine.stable_kernel_id`, emitted canonical unsigned
decimal strings, and rejected numeric encodings. The exact Attempt 30
TypeScript sketch-element type and codec omitted the `external_line` variant;
parsing therefore skipped its identity contract and serialization dropped its
`body` and `stable_kernel_id` fields. The storage protocol separately accepted
the numeric identity. The adversarial probe's exact outcomes were
`parsed: true` and `stored: true`, with lossy TypeScript serialization. That
state did not provide the same fail-closed persisted domain as Rust.

Attempt 30 remains immutable historical automated evidence but is rejected for
final qualification. The review issued no zero verdict and no waiver or partial
qualification is permitted.

Document-protocol remediation is now installed. The TypeScript union includes
the exact `external_line` shape; parse and serialization require the exact
Rust-compatible fields, safe two-coordinate integer pairs, and canonical
decimal-string `u64`; serialization preserves `body` and `stable_kernel_id`.
The document-protocol suite passes 11/11, including canonical boundary round
trips, malformed/numeric rejection, exact-field and coordinate validation, and
lossless serialization.

Storage remediation and its adversarial regression remain in progress. Once
they close, the post-Attempt-30 source must pass a fresh complete source-bound
no-waiver gate and isolated-bundle validation, the completion documents must be
reconciled to the new immutable run, and a fresh independent exact-state review
must return `ZERO FINDINGS`. The current state is **REJECTED — REMEDIATION IN
PROGRESS** (not qualified). Every included boundary remains frozen, and every
exclusion and deferral in Section 8 remains unchanged and unqualified.

## 23. Attempt 32 storage remediation checkpoint

Storage remediation is installed. Rust, document, and storage now require an
`external_line` with exactly six fields in Rust order: `kind`, `id`,
`start_nanometers`, `end_nanometers`, `body`, and `stable_kernel_id`.
Coordinate pairs contain exactly two safe integers; `id` and `body` are
nonempty; the identity is a canonical decimal string from `0` through
`u64::MAX`; and encode/decode plus save/load preserve every field without loss.
Numeric, malformed, missing, and extra-field forms fail closed.

Focused verification passed 11/11 document-protocol tests and 19/19 storage-
protocol tests. The Attempt 31 P1 is therefore closed at focused-remediation
scope only. Current state is **REMEDIATION COMPLETE — FULL SOURCE-BOUND RERUN
PENDING** (not qualified). A fresh complete no-waiver qualification run,
immutable bundle, reconciled documents, and independent `ZERO FINDINGS` review
remain mandatory; every prior attempt and every Section 8 exclusion/deferral
remains unchanged.

## 24. Attempt 33 persisted-ID audit checkpoint

The post-Attempt-32 audit found additional persistence mismatches:
crawler-sketch `ExternalReference` used `parse::<u64>()` and accepted padded or
signed strings; advanced-feature persisted request topology vectors were
numeric; the Sprint 4 WASM adapter used `Number` and native evidence accepted
numeric identities; alpha-reference raw evidence was numeric; and a history
test typed the persisted identity as a number.

Advanced-feature behavior remains functionally deferred from Sprint 4, but its
persisted request format is shared infrastructure and must satisfy the canonical
identity contract before rerun. Functional deferral does not waive persistence
correctness.

Crawler-sketch remediation is installed: canonical decimal strings at `0` and
`u64::MAX` pass, malformed/numeric/padded/signed/empty/whitespace/out-of-range
forms fail, and focused verification passed 3/3. The advanced-feature request,
Sprint 4 WASM/native evidence, alpha raw evidence, and history-test fixes remain
in progress.

Current state is **REMEDIATION IN PROGRESS — FULL RERUN PENDING** (not
qualified). All findings must close before the fresh source-bound no-waiver
run, immutable bundle, reconciled documents, and subsequent independent `ZERO
FINDINGS` review. All prior history and every Section 8 functional deferral
remain unchanged.

## 25. Attempt 34 persisted-ID remediation completion

Every Attempt 33 audit item is closed at focused-remediation scope:

- crawler-sketch canonical identity passes 3/3;
- feature-kernel serializes Draft, edge-treatment, and Shell topology-ID arrays
  as canonical decimal strings and passes 29/29 contracts plus 2/2 persistence;
- the application builder passes 20/20 plus TypeScript compilation, and runtime
  passes 2/2;
- the release-WASM exporter preserves strings/`BigInt` and passes 1/1, native
  evidence is string-only and passes 1/1, alpha evidence passes 5/5, and the
  history test type is corrected; and
- document 11/11 and storage 19/19 remain passing.

Current state is **REMEDIATION COMPLETE — FULL SOURCE-BOUND RERUN PENDING**
(not qualified). A fresh complete no-waiver qualification run, immutable
bundle, reconciled documents, and independent `ZERO FINDINGS` review remain
mandatory. Draft, edge treatment, Shell, and all other advanced-feature
behavior remain functionally deferred; their persistence correction does not
qualify those capabilities. All prior history and Section 8 deferrals remain
unchanged.

## 26. Attempts 35–38 post-remediation execution checkpoint

The first new run start archived the completed Attempt 30 `current` mirror as
`artifacts/solid-feature-qualification/runs/20260829T113815838Z-incomplete`.
That directory still contains its old 28/28 passing command set, passing report,
35 records, and 163 checksum entries under old manifest
`2dd9a81be451d011792eb46ac86275da092f16a20302f14e17c5de4433e16f79`
and source
`419dd8c4d9baa4f386b6cbebc0c406935e1a88f3c009780879304ad4a84b0a96`.
It is an administrative stale-current archive, not new evidence, and remains
subject to the Attempt 31 rejection.

Attempt 36,
`artifacts/solid-feature-qualification/runs/20260829T115821960Z-incomplete`,
bound current manifest
`4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`
and source
`3b1511f58c61d92ff568157bcb88dc6074fbd7851ee12b8841f0f2719a9942d3`
across 870 files with zero deletions, but `app-unit` stopped on sandbox
`EPERM` while resolving `C:\Volta`. It is rejected at 17/18 passed commands and
21 checksum entries. A workspace-local Node/pnpm shim preserved the exact tool
versions and manifest arguments for the next run; this environment workaround
is not feature evidence.

Attempt 37,
`artifacts/solid-feature-qualification/runs/20260829T121358296Z-incomplete`,
reached native/release-WASM comparison after 24 passing commands. Its prefix
included document 11/11, storage 19/19, application 240/240, worker 13/13,
parity/non-parity self-tests 15/15 and 6/6, the production build, and ten native
plus ten release-WASM exports. Parity passed 8/10. The two repair fixtures
differed only in accepted-document hashes because release-WASM evidence
correctly used canonical `u64::MAX` for a deliberately broken reference while
native evidence used a different sentinel. The 25-command, 50-checksum archive
is rejected and has no browser/performance, report, index, or final bundle.

Attempt 38 changes native `break_topology_reference` to
`u64::MAX.to_string()` without weakening the release-WASM path or comparator.
The focused root
`target/sprint4-focused-parity-20260829T121122215Z` contains ten newly exported
native fixtures, ten newly exported generated release-WASM fixtures, and a
10/10 zero-difference parity result under manifest
`4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`.
Independent artifact comparison confirmed an evidence-input-only discrepancy,
not a product-result mismatch.

Current state is **FOCUSED PARITY REMEDIATION PASSED — FULL SOURCE-BOUND RERUN
PENDING** (not qualified). A fresh complete run, immutable bundle, reconciled
documents, and independent exact-state `ZERO FINDINGS` review remain mandatory.
All earlier findings, shortcomings, and exclusions remain append-only history.
The frozen boundary and every deferral remain unchanged: arbitrary/angled/
tangent/three-point/face-derived datum planes; curved or nonanalytic supports;
automatic healing, split/merge, or topology-changing rebind; cross-component/
cross-support/general rebind; two-side/start/target extents;
Join/Cut/Intersect/targets; handles, draft, and thin Extrude; and
Revolve/Sweep/Loft are unqualified.

## 27. Attempt 39 source-snapshot race rejection

Attempt 39 is archived at
`artifacts/solid-feature-qualification/runs/20260829T122635405Z-incomplete`.
It bound manifest
`4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`
and initially captured source SHA-256
`d5520d32d15ac939f15bbd5a3448b772441f0a89e8809a338155978375455c32`
under `sha256-git-visible-path-content-v1` across 870 entries/files with zero
deleted paths. All 26 recorded commands exited successfully, including ten
native and ten generated release-WASM exports, 10/10 parity, and production
browser JUnit 2/2 with zero failures, errors, or skips.

The mandatory source recheck after the browser gate rejected the run before
final indexing, reporting, checksum completion, and sealing: expected
`d5520d32d15ac939f15bbd5a3448b772441f0a89e8809a338155978375455c32`,
observed
`1853adee34b4febc4f76277b54941251efc8c00f33a45926be1d80a2125bd3cc`.
Concurrent qualification-document edits changed Git-visible source during the
run. Attempt 39 is therefore rejected despite its passing command prefix; no
source-binding waiver is allowed.

## 28. Attempt 40 complete automated qualification checkpoint

The full post-remediation no-waiver gate passed and sealed immutable run
`artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`.
The bundle binds manifest SHA-256
`4bd4daa7110e5150e3e18157d5586b04ab93194c23c5abaa934507331e81e2d7`,
Git commit `3f2ec88b4687c15cd8721f840ed21b293955f95e`, and source SHA-256
`f4f01a45db55c2626a36c7a161db6da788e62b650cbc73efb1035ca0d87a76f6`
under `sha256-git-visible-path-content-v1` across 870 entries/files with zero
deleted paths and only `artifacts/solid-feature-qualification/**` excluded.

All 28 commands passed. The complete evidence includes full native workspace,
focused native planar-face contracts 5/5, zero-warning lint, five release-WASM
compilation gates, document 11/11, storage 19/19, operation mirror 7/7,
deterministic generation, application units 240/240, worker 13/13, parity
self-tests 15/15, non-parity self-tests 6/6, production build, ten native and
ten generated release-WASM results, 10/10 zero-difference parity, production
browser JUnit 2/2, and eight unobscured screenshots.

Both locked performance workloads passed with zero violations and zero Long
Tasks. `extrude-planar-face-rectangle` ran 2 warmups, 10 measured iterations,
and 50 cancellation cycles with preview p50/p95
48.200000047683716/54.700000047683716 ms, recompute p50/p95 18/21.1 ms,
cancellation maximum 51.89999985694885 ms, and +1,363,204 bytes observed heap
growth. `planar-face-support-repair` ran 2/10/50 with preview p50/p95
63.299999952316284/118.90000009536743 ms, recompute p50/p95
128.5/231.70000004768372 ms, cancellation maximum 42.700000047683716 ms,
+866,640 bytes observed heap growth, one candidate, and 62 deterministic ranking
observations.

The locked build remains `solid-feature-sprint-4-r1-20260828`; generated
release-WASM SHA-256 is
`0e1f3cb3b3c1605df02ee34e87546563ee199a3678bb7d7b6b3c810cf5e9cd89`
(10,893,016 bytes), feature-kernel SHA-256 is
`c1da7574b86b570b9ce3e8ef07c0e3b05c2f266003dd2b3ceca5283abb272c00`
(4,995,660 bytes), and operation-catalog SHA-256 is
`ad5673ef974112e631a3813894496449f9d02eedfefbb51e22f4c3cf679aad1d`
(38,721 bytes). The bundle contains 35 qualification records and 163 checksum
entries; the in-step isolated validator passed its pre-final-ledger set at 35
records and 162 checksummed files. The qualification report is `passed`,
post-copy bundle validation passed, and the structured qualification invocation
SHA-256 is
`5bc7b97d18a1e981aa0d6048b891685cd4b20d09ba33242b1aa946d4a0f1e174`.

Current state is **AUTOMATED PASS — INDEPENDENT REVIEW PENDING** (not
qualified). Final qualification requires an independent exact-state review of
the Attempt 40 source, contracts, tests, repeatable harness, immutable bundle,
and reconciled documentation returning `ZERO FINDINGS`. Every earlier finding,
rejection, and remediation remains append-only history. Section 8 remains
unchanged: arbitrary/angled/tangent/three-point/face-derived datum planes;
curved/nonanalytic supports; automatic healing, split/merge, or topology-
changing rebind; cross-component/cross-support/general rebind; two-side/start/
target extents; Join/Cut/Intersect and targets; handles, draft, and thin
Extrude; and Revolve/Sweep/Loft remain deferred and unqualified.

## 29. Attempt 41 independent qualification completion

Fresh independent reviewer `/root/sprint4_zero_gate_attempt40` audited the
current Sprint 4 source and contracts, immutable Attempt 40 bundle
`artifacts/solid-feature-qualification/runs/20260829T123714Z-solid-feature-sprint-4-r1`,
repeatable harness, test coverage, native/release-WASM parity, production
browser and performance evidence, reconciled documentation, recorded
shortcomings, and explicit deferrals. The reviewer returned the exact
standalone verdict `ZERO FINDINGS`.

Sprint 4 revision 1 is therefore **QUALIFIED** for its frozen boundary: current
analytic planar-face-supported Blind New Body Extrude over the qualified
line/arc/circle/hole profile domain, plus explicit compatible repair on the
same body, producer, and component. Attempt 40 remains the immutable automated
evidence identity; Attempt 41 is the mandatory independent completion gate. No
waiver, partial result, or historical rejected bundle contributes to the
qualification decision.

Sprint 4 is complete. The next modernization sprint must be selected and frozen
separately in initiative dependency order. This status does not qualify or pull
forward arbitrary/angled/tangent/three-point/face-derived datum planes; curved
or nonanalytic supports; automatic healing, split/merge naming, or topology-
changing rebind; cross-component/cross-support/general rebind; two-side/start/
target extents; Join/Cut/Intersect and targets; handles, draft, or thin
Extrude; or Revolve/Sweep/Loft. Those capabilities remain explicitly deferred
and unqualified.

## 30. Attempt 42 final documentation-only completion gate

The same independent reviewer, `/root/sprint4_zero_gate_attempt40`, re-reviewed
the final reconciled four-document Sprint 4 completion set: qualification
ledger, Sprint 4 specification, initiative record, and backlog. The review also
covered the successful `git diff --check` result and returned the exact
standalone verdict `ZERO FINDINGS`.

All Sprint 4 completion gates are therefore closed, and no required work
remains for the bounded qualified scope. Attempt 40 remains the immutable
automated evidence bundle, Attempt 41 is the independent exact-state zero-
finding gate, and Attempt 42 is the final documentation-only zero-finding gate
from the same reviewer. Sprint 4 revision 1 remains **QUALIFIED** without
waiver.

Every prior rejection, remediation, and shortcoming remains append-only
history. The exclusions in Section 8 remain deferred and unqualified and are
not required work for this completed bounded scope: arbitrary/angled/tangent/
three-point/face-derived datum planes; curved/nonanalytic supports; automatic
healing, split/merge naming, or topology-changing rebind; cross-component/
cross-support/general rebind; two-side/start/target extents;
Join/Cut/Intersect and targets; handles, draft, or thin Extrude; and
Revolve/Sweep/Loft.
