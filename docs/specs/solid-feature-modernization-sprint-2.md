# Extrude Direction Modes — Sprint 2

- Status: qualified — automated gate, isolated immutable-bundle validation, and independent zero-finding review passed
- Planning date: 2026-08-27
- Sprint goal: deliver exact, durable Reverse and Symmetric blind New Body Extrude on all three origin planes
- Parent initiative: [Solid Feature Modernization Initiative Backlog](solid-feature-modernization-initiative.md)
- Prior qualified baseline: [Solid Feature Foundations — Sprint 1](solid-feature-modernization-sprint.md)
- Qualification ledger: [Solid Feature Sprint 2 Qualification](../qualification/solid-feature-sprint-2-qualification.md)
- Frozen candidate: `contracts/solid-feature-candidate/sprint-2.json`

## 1. Outcome and boundary

Sprint 2 extends the qualified Sprint 1 blind New Body Extrude with three
direction modes. Public UI labels are **Forward**, **Reverse**, and
**Symmetric**. Durable document, request, worker, and evidence tokens are exactly
`positive`, `negative`, and `symmetric`.

For a support-plane origin `O`, unit positive normal `N`, and positive stored
magnitude `d`:

| Durable mode | Occupied normal interval | UI label |
|---|---:|---|
| `positive` | `[O, O + dN]` | Forward |
| `negative` | `[O - dN, O]` | Reverse |
| `symmetric` | `[O - dN, O + dN]` | Symmetric |

`d` is the one-sided distance for Forward/Reverse and the **half-distance** for
Symmetric. Therefore Symmetric's total depth is `2d`. This rule is identical in
preview, commit, durable storage, edit, recompute, native execution, generated
release WASM, and evidence. Zero, negative, non-finite, missing, or unknown
values fail closed without changing the accepted document or bodies.

The slice accepts one qualified line/arc/circle region with holes on origin XY,
XZ, or YZ and produces one exact New Body. It does not add a second side,
asymmetric two-sided values, start offsets, target bodies, or a new support kind.

## 2. Why this is the next bounded slice

Sprint 1 qualified durable profiles, stable regions, exact positive blind New
Body execution, create/edit lifecycle, and a content-bound native/release-WASM/
browser gate. Direction modes can now be added through that same vertical path
without inventing Boolean, support-entity, or termination semantics.

Construction planes are not the next implementation slice because the document
currently has a reference token but no fully evaluated construction-plane entity
and dependency/repair lifecycle. Planar-face support additionally needs durable
topology rebinding. Join/Cut require target selection and a qualified release-WASM
Boolean contract. Those prerequisites are not hidden inside direction work.

## 3. Frozen candidate and traceability

Candidate `solid-feature-sprint-2` revision 1 contains only these stories:

| Sequence | Story | Priority / size | Required outcome |
|---:|---|---|---|
| 1 | E3D-S2-01 | P0 / M | One typed, canonical direction contract across document and requests |
| 2 | E3D-S2-02 | P0 / L | Exact native/release-WASM Reverse and Symmetric execution |
| 3 | E3D-S2-03 | P0 / L | Unified Forward/Reverse/Symmetric create/edit lifecycle |
| 4 | E3D-S2-04 | P0 / M | Distinct, zero-waiver Sprint 2 evidence bundle and independent review |

This is a deliberate subset of the old E3D-S1-09 stretch description. It does
**not** mark E3D-S1-09 complete because that story also named angled/construction
plane evidence. Sprint 2 uses new IDs so its narrower qualification cannot be
mistaken for completion of the broader deferred story.

### 3.1 Implementation ledger

`Implemented` never means `Qualified`. Update this table with exact evidence and
shortcomings; never erase failure history from the qualification ledger.

| Story | State | Completion evidence or shortcoming |
|---|---|---|
| E3D-S2-01 | Qualified | Durable tokens, compatibility default, request/worker boundaries, operation catalog, complete contract gate, and zero-finding independent re-review passed. |
| E3D-S2-02 | Qualified | Exact Reverse/Symmetric conversion, durable recompute, 6/6 origin-plane matrix, both 2/2 fixture-oracle sets, 2/2 zero-difference native/release-WASM parity, and zero-finding independent re-review passed. |
| E3D-S2-03 | Qualified | 219/219 unit checks, production build, manifest-locked direction lifecycle, renderer-resource accounting, unchanged performance budgets, and zero-finding independent re-review passed. |
| E3D-S2-04 | Qualified | Build `solid-feature-sprint-2-r1-20260827` and release-WASM SHA-256 `47db4148fd18b2a08467bdc8058b7815dedb30fd49171195364a34f5acef46f7` are locked. The corrected complete bundle contains all 25 required passed records and 109 checksummed files at `artifacts/solid-feature-qualification/runs/20260828T035943Z-solid-feature-sprint-2-r1`; isolated validation and the fresh zero-finding independent completion re-review passed. |

## 4. Stories

### E3D-S2-01 — Define durable blind Extrude direction modes

**Story:** As a modeler, I need direction to be an explicit durable Extrude
parameter so reopening or editing a feature cannot change its side implicitly.

**Acceptance criteria:**

1. The typed document enum and every production request/worker boundary accept
   exactly `positive`, `negative`, or `symmetric`; no Boolean alias or UI label is
   serialized as authority.
2. Existing V2 definitions with `positive` remain byte-semantically compatible;
   canonical round-trip and generated mirrors cover all three values.
3. The stored magnitude is positive. For `symmetric` it is explicitly the
   half-distance; changing mode does not create a hidden second parameter.
4. Unknown tokens and invalid magnitudes return a structured error naming the
   field and preserve accepted document/body hashes.
5. Preview and commit consume the same normalized definition. Recompute reads
   the durable mode rather than defaulting to the positive normal.
6. Document, history/versioning, generated bindings, catalog/mirrors, and
   save/reopen tests cover every new enum value.

### E3D-S2-02 — Execute exact Reverse and Symmetric New Body Extrude

**Story:** As a modeler, I need the solid to appear on the selected side or
equally on both sides without sketch relocation or destructive workarounds.

**Acceptance criteria:**

1. Reverse translates along `-N` and occupies exactly `[-d, 0]` relative to the
   support. Symmetric occupies exactly `[-d, +d]`; a tessellated mirror or two
   unrelated bodies is not acceptable.
2. Native and generated release WASM execute the same normalized definition and
   agree within fixture tolerances for bounds, signed volume, surface area,
   centroid, manifoldness, outward orientation, analytic classification, stable
   identity sets, and canonical document hash.
3. The checked XY rectangle fixtures prove: Reverse 4 mm bounds
   `[-5,-3,-4,5,3,0]` mm, centroid `[0,0,-2]` mm, volume `240 mm³`, area
   `248 mm²`; Symmetric half-distance 4 mm bounds `[-5,-3,-4,5,3,4]` mm,
   centroid `[0,0,0]`, volume `480 mm³`, and area `376 mm²`.
4. Automated Rust/runtime coverage exercises both new modes on origin XY, XZ,
   and YZ and asserts the expected world-axis bounds. The two manifest parity
   exemplars and the production-browser lifecycle remain representative XY
   cases; the other four mode/plane cells must pass named Rust/runtime tests in
   the same candidate run.
5. Direction-mode edit, accepted-state cancellation, save/reload, and durable
   recompute preserve mode, magnitude, feature/body identity ownership, and
   exact geometry. Existing workspace regression suites remain responsible for
   generic suppress, undo/redo, and upstream-sketch behavior.
6. Failure or stale preview results cannot mutate the accepted feature or body.
   Empty/open/overlapping profile rejection remains at least as strict as Sprint 1.

### E3D-S2-03 — Unify Forward, Reverse, and Symmetric create/edit UX

**Story:** As a modeler, I need to choose and edit direction in the existing
Extrude command with immediate trustworthy preview.

**Acceptance criteria:**

1. The existing create and timeline-edit panel exposes one mode control labeled
   Forward/Reverse/Symmetric; create and edit do not use separate schemas.
2. Selection-first and tool-first entry initialize the same normalized state.
   Timeline edit displays the stored mode and half-distance semantics.
3. Changing mode or magnitude dispatches production-worker preview; cancel
   restores the last accepted definition and geometry, and commit stores exactly
   the accepted preview inputs.
4. The mode control is keyboard accessible, and numeric entry, keyboard steps,
   and the existing pointer distance widget agree on the stored magnitude.
   Production geometry preview must be direction-accurate in every camera view;
   camera changes cannot alter mode semantics. A model-space anchored arrow or
   both-side directional graphic is not claimed by this sprint.
5. A representative XY production-build browser test uses the real model worker
   and manifest-locked release WASM to create Reverse, switch and cancel a stale
   Symmetric preview, commit an exact normalized Symmetric total, then
   save/reload and reopen edit. Passing screenshots include Reverse and
   Symmetric accepted/edit states; the six-cell origin-plane matrix is owned by
   the Rust/runtime acceptance criterion above.
6. No console/page errors, mock worker, TypeScript substitute geometry, skipped
   assertion, or reused Sprint 1 qualification record can satisfy this story.
7. Existing locked preview/recompute performance workloads pass without budget
   regression in the same run; raw observations remain in `performance/results.json`.

### E3D-S2-04 — Qualify Sprint 2 without waivers

**Story:** As a release owner, I need distinct content-bound evidence so the new
mode claims are reproducible rather than inferred from Sprint 1.

**Acceptance criteria:**

1. `sprint-2.json` passes schema/reference validation and the incomplete,
   duplicate-ID, invalid-sprint-ID, stale-lock, missing-artifact, failed, skipped,
   blocked, and waived cases fail closed.
2. A fresh run records candidate ID/revision/manifest hash, build ID, release-WASM
   hash, source snapshot, environment, commands, runtime evidence, parity, browser
   JUnit, screenshots, performance, records, and checksums.
3. Each story, fixture, test, and required artifact has exactly one passed,
   identity-bound record. Sprint 1 records cannot satisfy Sprint 2 IDs.
4. The timestamped bundle validates in isolation without resolving mutable
   worktree or `current` paths. No candidate waiver is permitted.
5. A fresh independent read-only reviewer reports zero findings across scope,
   semantics, implementation, tests, bundle integrity, and documentation. Any
   finding keeps the sprint unqualified until fixed and the affected gate reruns.

## 5. Definition of done and repeatable gate

All four stories must be `Qualified`; generated output must be synchronized and
byte-repeatable; native and release-WASM fixture evidence must pass 2/2 with
zero parity differences; all six `(mode, origin plane)` new-mode cells must pass
automated assertions; manifest-owned production browser suites must have zero
failures/errors/skips; performance budgets must pass; and the independent review
must return zero findings. Partial implementation is recorded as a shortcoming,
not promoted by changing status text.

After implementation, freeze the actual build ID and release-WASM SHA-256 in
both lock locations in `sprint-2.json`, then run:

```powershell
$env:CARGO_BUILD_JOBS = "2"
Remove-Item Env:RUSTC_WRAPPER -ErrorAction SilentlyContinue

pwsh -NoProfile -File contracts/solid-feature-candidate/test/manifest-validation.tests.ps1

pwsh -NoProfile -File scripts/qualify-solid-features.ps1 `
  -Manifest contracts/solid-feature-candidate/sprint-2.json `
  -NativeEvidenceCommand 'pwsh -File scripts/export-solid-feature-runtime-evidence.ps1 -Manifest contracts/solid-feature-candidate/sprint-2.json -Runtime native' `
  -WasmEvidenceCommand 'pwsh -File scripts/export-solid-feature-runtime-evidence.ps1 -Manifest contracts/solid-feature-candidate/sprint-2.json -Runtime release-wasm'
```

The Sprint 1 manifest remains runnable by explicitly passing
`-Manifest contracts/solid-feature-candidate/sprint-1.json`; script defaults stay
Sprint 1 for backward compatibility.

## 6. Explicitly deferred work

| Deferred capability | Reason it is not implied by Sprint 2 |
|---|---|
| Construction planes and angled supports | Requires an evaluated document entity, frame origin, dependency ordering, edit/repair, and persistence evidence; a reserved reference token is insufficient. |
| Planar-face support | Requires stable topology selection/rebinding and lost-reference repair across recompute. |
| Join/Cut and target selection | Requires target-body UX and qualified release-WASM Boolean semantics, including disjoint/empty/multi-shell cases. |
| Asymmetric two-side, start offset, up-to-face/body, through-all | Requires a unified extent/start/termination contract and ambiguity rules. |
| Model-space anchored direction arrow/both-side handles | The current handle is a screen-space distance widget. Model-space manipulation and occlusion behavior remain E3D-07-S02 work; Sprint 2 qualifies accessible mode selection and direction-accurate geometry preview instead. |
| Taper/draft and thin Extrude | Requires offset/draft validity, self-intersection, neutral-plane, and thickness-side contracts. |
| Revolve | Remains the next feature-family tranche after shared profile/extent prerequisites; this sprint does not add axes or angular extents. |
| Sweep | Current prepared operation is not a qualified tangent-following sweep; path frames, twist, corners, and self-intersection remain open. |
| Loft | Rails, section correspondence, boundary derivatives, continuity measurement, and singularity handling remain open. |

No deferred item may be represented by a disabled control, hidden fallback, or
observation presented as candidate completion.
