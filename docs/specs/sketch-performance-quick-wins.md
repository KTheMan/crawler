# Sketch performance quick-win plan

- Status: phases 0--5 implemented and phase-audited; complete five-sample production matrix passed; 20-sample release coverage remains explicitly scoped
- Created: 2026-08-12
- Baseline: [`../qualification/sketch-performance-baseline.md`](../qualification/sketch-performance-baseline.md)
- Product constraint: preserve Fusion-class in-canvas selection, preselection, inferencing, constraints, Smart Dimension, stable geometry identity, and retained parametric intent
- UX contract: [`sketch-workspace-ux-flow.md`](sketch-workspace-ux-flow.md), especially UX-INV-001 through UX-INV-012

## Objective

Remove the severe mild-sketch stalls with the smallest, safest changes first. A quick win is acceptable only when it improves measured interaction or long-task results without hiding geometry, delaying essential pointer feedback, weakening constraints, reducing native-curve accuracy, changing selection semantics, or bypassing retained operations.

## Execution status (2026-08-13)

| Phase | Status | Current evidence |
| --- | --- | --- |
| 0 — evidence contract | Complete; independent harness audit passed | Production-preview parent watchdog, deliberate wedge fixture, durable checksummed artifacts, exact semantic selectors, explicit additive-selection automation, and nullable empty percentiles are implemented. |
| 1A — diagnostic scheduling | Complete; independently audited | Obsolete generations skip calculation/publication; queued work coalesces to the latest generation with counters and deterministic focused tests. |
| 1B — diagnostic broad phase | Complete; independently audited | Per-generation samples/bounds are reused; entity/segment bounds reject noncandidates; reference equivalence and deterministic ordering pass. |
| 2 — render bookkeeping | Complete; independently audited | Participation, solve-component, retained-operation, and suppression indexes are revision-owned and reused by overlay generation. |
| 3 — transient pointer path | Complete; independently audited | Pointer frames preserve the final event, update transient layers without stable-layer regeneration, cache native display sampling, and avoid unchanged inspector reconstruction. |
| 4A — linear offset discovery | Complete; independently audited | Endpoint adjacency plus breadth-first expansion is linear; the 3,000-ray adversarial fixture and phase-local instrumentation pass. |
| 4B — certified compact offsets | Complete; independent certification audit passed | Supported curve families use analytic conservative certificates and compact editable spline results; clockwise sweep, overflow, error-bound, and stable-ID findings were closed. |
| 5 — canonical worker preview | Complete; independently audited | Preview uses the existing worker batch path with abort/staleness/ownership guards; accept is atomic, single-use, one-history-entry, and does not recompute. |
| Final program qualification | Complete for the requested quick-win program | The final production matrix passed 210/210 independent child runs (42 scenarios at 5/5), with no action-overlapping long task. Independent performance/dev and design/UX audits passed. A separate 20-process release percentile was completed for the formerly outlying two-point circle; universal 20-sample coverage remains a broader release-certification task, not a claim of this five-sample program. |

Phase-local and final five-run evidence is recorded in
[`../qualification/sketch-performance-baseline.md`](../qualification/sketch-performance-baseline.md).
The complete parent-runner matrix now includes control- and fit-spline offsets at 5/5.
Five-run evidence is diagnostic/program qualification; it is not silently represented
as universal 20-sample release percentile coverage.

## Prioritization method

Items are ranked by expected user impact, implementation effort, confidence in the diagnosed cause, regression risk, and reversibility. The first phase deliberately targets repeated work and obsolete work; it does not alter CAD semantics.

| Rank | Remediation | Expected impact | Effort | Risk | Why now |
| ---: | --- | --- | --- | --- | --- |
| 1 | Precompute and broad-phase profile diagnostics; cancel stale generations before calculation | Very high | Small–medium | Low | Directly attacks pairwise curve resampling and obsolete jobs implicated by cumulative curve stalls. |
| 2 | Pre-index overlay solve/constraint participation once per render revision | High | Small | Low | Removes geometry × constraints scans and repeated `JSON.stringify` without changing visible output. |
| 3 | Split pointer feedback from full overlay reconstruction | Very high | Medium | Medium | Keeps hover, snap, inference, and dimension preview responsive without rebuilding stable geometry layers every pointer frame. |
| 4 | Cache native-curve display sampling and update only changed dynamic entities | High | Medium | Medium | Avoids resampling stable curves and scanning every SVG entity while retaining exact model geometry. |
| 5 | Make connected-offset expansion linear and instrument generated complexity | Medium | Small | Low | Removes avoidable repeated scene scans and makes offset amplification observable. |
| 6 | Bound and redesign native-curve offset output | Very high | Medium–large | Medium–high | Required for multi-second retained offsets, but must preserve tolerance, identity, editability, and solver intent. |
| 7 | Move remaining heavy diagnostics/offset preview computation off the interaction thread | High | Large | Medium | Strong isolation after cheaper duplicate-work fixes are proven insufficient. |

## Phase 0 — lock the evidence contract (complete)

This is a prerequisite, not an excuse to delay code improvements.

1. Repair deterministic selection targeting in the isolated line and mild additive-selection probes.
2. Repair each constraint/edit operand workflow until the intended mutation is observed; keep unconfirmed rows classified as automation failures.
3. Run every target at least five times in a production build and preserve raw samples, browser version, machine description, and test commit.
4. Use warm-up plus at least 20 measured samples for release interaction percentiles; retain both semantic-mutation and two-frame stable-paint latency.
5. Add a compact results artifact under the qualification output rather than relying on console logs. Include run ID, commit, dirty patch/build hash, headed/headless mode, production/development mode, browser/OS/hardware, sample counts, and artifact checksum.
6. Bind class-based probe completion to the exact interacted SVG member so duplicate geometry markup cannot cause a false missing sample.
7. Record trace/long-task intervals so a maximum long task can be attributed to the action window rather than the entire scene by inference.
8. Run every risky scene behind a killable child-process/browser boundary controlled by an outer runner. On deadline, persist partial scenario metadata outside the child, terminate only that child/browser process tree, and continue remaining cases. Do not rely on `Promise.race` or `context.close()` to interrupt a blocked renderer.
9. Add a deliberately blocking fixture test proving one wedged scene cannot prevent later scenes or final artifact assembly.
10. Keep the exact mild functional lifecycle test beside the performance gate.

Exit criteria:

- no required interaction reports zero samples;
- every measured constraint/edit row proves its semantic mutation;
- the outer runner forcibly terminates a deliberately blocked child, preserves its timeout metadata, runs later cases, and finalizes the complete results artifact; and
- an independent test-audit agent confirms the harness does not mask failures.

## Phase 1A — cancel obsolete diagnostic generations (complete)

Ownership: `web/crawler-app/src/sketch-editor.ts` and focused unit tests.

### Implementation

1. Check the diagnostic generation before starting scheduled work so obsolete jobs return without calculation.
2. Coalesce queued diagnostics to the newest draft. Continue to publish the latest complete diagnostic result asynchronously.
3. Count scheduled, skipped, executed, and published generations in test instrumentation.

### Acceptance

- Unit tests prove stale scheduled generations neither execute the diagnostic function nor publish a result.
- The latest generation publishes exactly once and remains deterministic.
- Existing diagnostic and sketch lifecycle suites pass unchanged.
- A before/after trace reports diagnostic executions eliminated during rapid scene construction.

Rollback: this is an isolated scheduler change and must land separately from the diagnostic algorithm.

## Phase 1B — broad-phase and reuse profile diagnostics (complete)

Ownership: `web/crawler-app/src/sketch-editor.ts` and focused unit tests.

### Implementation

1. Build each entity's diagnostic segments and bounds once per diagnostic generation, outside the geometry-pair loop.
2. Reject entity pairs whose bounds do not overlap before segment comparisons.
3. Add segment-bound rejection before exact overlap/intersection/touch predicates.
4. Stop comparing a pair after the highest-priority diagnostic for that pair is known.
5. Record entity count, sampled segment count, candidate/rejected pair counts, and exact segment comparisons in test instrumentation.

### Correctness and UX constraints

- The same settled sketch must produce the same diagnostics in the same deterministic order.
- Actionable crossing, overlap, touching-contour, gap, and orphaned-reference canvas feedback must remain available.
- Pointer preselection, snap badges, creation facsimiles, and dimension previews must not wait for diagnostics.
- Do not disable diagnostics for native curves or construction-heavy sketches merely to improve timing.

### Acceptance

- Add a corpus test comparing old/reference and optimized diagnostic sets across lines, circles, arcs, splines, ellipses, elliptical arcs, conics, overlaps, tangencies, and nonintersecting dense scenes.
- Assert deterministic diagnostic ordering as well as set equivalence.
- Mild + ellipse and mild + control-point spline finish below the existing 1,500 ms creation ceiling with no main-thread task over 100 ms.
- Five repeated runs show no 20-second watchdog and no diagnostic loss.
- The phase report shows reduced sample evaluations/exact segment comparisons, rather than attributing an end-to-end improvement without a local cost signal.

Rollback: retain the reference implementation in tests, not in the production hot path; revert the optimized function if diagnostic equivalence fails.

## Phase 2 — render bookkeeping: index once, render the same result (complete)

Ownership: `web/crawler-app/src/main.ts`, plus a small typed helper module and unit tests.

### Implementation

1. Create a typed constraint-to-geometry reference extractor covering every constraint union member.
2. Build a `geometryId → participation count` map once per draft revision.
3. Build a `geometryId → solve component` map once per solve result.
4. Build retained-operation and suppressed-instance indexes once per draft revision.
5. Reuse these indexes while generating overlay markup. Remove per-entity `Object.values(...).filter(JSON.stringify(...))` and linear component searches.

### Correctness and UX constraints

- `data-participation`, degrees-of-freedom classes, conflict display, operation selection, accessibility labels, and constraint manager values remain identical.
- Use exhaustive TypeScript switching so a new constraint kind cannot silently disappear from participation.
- Do not remove relationship counts or constraint annotations as a performance shortcut.

### Acceptance

- Unit fixtures assert exact indexes for every constraint kind.
- Overlay snapshot/DOM-semantic tests pass before and after the change.
- Mild checkpoint hover p95 remains at or below 50 ms; snap and selection p95 are at or below 100 ms; no long task exceeds 100 ms.
- Dense polygon/slot scenes show a measurable reduction in script time in a browser trace.
- Phase-local evidence records stable-layer generation time and eliminates per-entity constraint serialization/component searches.

Rollback: the helper is pure and can be reverted independently of rendering or document semantics.

## Phase 3 — pointer path: update transient feedback only (complete)

Ownership: `web/crawler-app/src/main.ts`, `sketch-svg-layer-cache.ts`, `sketch-svg-reconciler.ts`, and focused Playwright tests.

### Implementation

1. Separate stable geometry/handle/annotation rendering from transient cursor, facsimile, inference-guide, preselection, selection-box, and pending-dimension rendering.
2. On pointer animation frames, update only dynamic classes and the transient/selection layers unless the draft, solve result, profile result, viewport transform, visibility, or selection model changed.
3. Give draft/solve/profile/view/selection state explicit revision tokens rather than inferring freshness from DOM strings.
4. Coalesce pointer updates to one per animation frame while always processing the most recent pointer position.
5. Cache native-curve display samples by geometry identity/revision and view transform. If zoom-dependent tessellation is introduced, keep visual error within 0.5 CSS px and invalidate on zoom.
6. Track previous and next hover/inference IDs and toggle only the changed set instead of scanning every SVG entity.
7. Skip inspector/tool UI reconstruction when its semantic state has not changed, while preserving changed invalid-target reasons.

### Correctness and UX constraints

- Never throttle away the final pointer position, click target, snap result, inference source/target, or dimension placement.
- Preselection and snap/inference feedback remain immediate and visually identical.
- Smart Dimension measurement markers, horizontal/vertical/aligned/angle previews, and in-canvas editor placement remain synchronized with the latest pointer state.
- Selection-first and tool-first Smart Dimension flows remain equivalent; repeat-after-commit remains active. Point distance, radius, diameter, ellipse-axis, and retained-offset modes receive the same audit as horizontal/vertical/aligned/angle placement.
- Keyboard navigation and assistive labels must observe the same selected/preselected semantic state.
- Enlarged hit geometry and overlapping-object selection remain unchanged; rendering caches never become hit-test authority.

### Acceptance

- Automated pointer sweeps prove that the final event wins and that no stale highlight remains.
- Cold hover p95 ≤ 50 ms; warm hover p95 ≤ 32 ms; snap/inference p95 ≤ 50 ms; selection p95 ≤ 100 ms on the mild and native-curve scenes.
- Pointer sweeps perform no stable geometry-layer updates when revision tokens are unchanged.
- Visual regression checks cover selected, preselected, invalid, inference, construction, constrained, and Smart Dimension states.
- Zoom tests prove cached curve display remains within 0.5 CSS px of the authoritative native curve and refreshes at every relevant view change.
- Smart Dimension mode/preview stable paint is ≤ 50 ms and its in-canvas editor receives focus within 100 ms.
- Any exact operation that cannot finish within 100 ms produces truthful visible preview/busy acknowledgement within 100 ms while pointer feedback remains responsive.

Rollback: keep stable and transient render entry points independently callable; fall back to a full render on unknown revision state.

## Phase 4 — offset amplification: remove avoidable growth first (complete)

Ownership: `web/crawler-app/src/sketch-operations.ts`, solver/profile tests, and offset Playwright cases.

### Part A: safe quick win

1. Replace repeated connected-chain whole-scene scans with an endpoint adjacency index and breadth-first traversal.
2. Record source count, adaptive interval count, result entity count, constraint count, preview time, commit time, and maximum long task.
3. Separately time generator, command construction, solver bridge, diagnostics, overlay render, and stable paint so an end-to-end timeout is not attributed by inference.
4. Reject nonfinite frames and degenerate intervals explicitly; never recurse without a termination/depth invariant.

### Part B: representation improvement

After profiling confirms output explosion remains dominant:

1. Define an error-bounded native offset approximation contract in model units.
2. Replace one degree-1 spline per interval with the smallest deterministic spline chain satisfying the tolerance.
3. Retain stable source-parameter intervals and one editable offset intent; avoid creating redundant solver constraints for purely dependent internal joins.
4. Consider worker-side preview generation, but commit through the same canonical command and history path.

### Correctness and UX constraints

- Do not loosen curve tolerance based on current zoom for durable geometry.
- Preview may use a documented coarser display tolerance, but committed geometry must meet the model tolerance.
- Offset remains associative, editable, undoable, reloadable, and selectable with stable source relationships.
- The preview must appear progressively or within budget; never freeze the pointer while silently calculating.

### Acceptance

- Hausdorff/error tests cover convex, concave, high-curvature, nearly degenerate, open, closed, clockwise, and reversed curves.
- Undo/redo, save/reload, downstream profiles, Smart Dimension offset distance, and stable operation identity pass.
- Each native offset preview and commit has p95 ≤ 500 ms, no long task over 100 ms, and no 15-second watchdog in five runs.
- Generated entity and constraint counts are bounded by the documented tolerance and curve complexity, with regression fixtures for worst cases.

Rollback: land adjacency indexing and instrumentation separately from representation changes; feature-gate the new approximation during qualification if both representations must be compared.

## Phase 5 — worker isolation only where still justified (complete)

If Phases 1–4 do not meet the interaction targets, move profile diagnostics and offset preview calculation to a worker with generation IDs, cancellation, deterministic result serialization, and latest-result-only publication. Do not duplicate geometric algorithms independently across main and worker code; share pure modules and run equivalence tests in both environments.

## Delivery and audit protocol

Each phase is a separate, reviewable change:

1. Capture before traces and raw matrix JSON on the same production build environment.
2. Add correctness tests and a phase-local cost signal before or with the optimization.
3. Implement one cost-center change without unrelated refactoring.
4. Run TypeScript, focused unit tests, functional sketch lifecycle tests, the relevant performance subset, then the full matrix.
5. Capture after traces and report median, p95, maximum, long tasks, timeouts, geometry/constraint counts, and artifact paths.
6. Run two independent audits before closing the phase:
   - performance/dev-practice audit: inspect the diff and raw artifacts for algorithmic claim, test validity, cancellation, complexity, determinism, cache ownership/invalidation, memory, rollback, and maintainability;
   - design/UX audit: actually exercise and visually inspect preselection, snap/inference, final-pointer-wins behavior, overlapping selection, keyboard/accessibility, construction/constraint visibility, direct manipulation, and Smart Dimension horizontal/vertical/aligned/angle flows.
7. Address every high-severity finding or record the phase as blocked; do not self-certify completion.

## Anti-patterns explicitly rejected

- increasing watchdogs or budgets to convert a failure to a pass;
- suppressing profiles, constraints, points, diagnostics, or measurement markers by default;
- lowering native curve accuracy without a durable tolerance contract;
- sampling fewer entities only in the benchmark;
- debouncing pointer feedback so aggressively that final state or clicks are lost;
- moving work to `setTimeout` while still executing every stale job;
- broad untyped caches without revision ownership and invalidation tests;
- bypassing the solver, history, operation record, or stable IDs for a faster preview; and
- accepting average latency while p95, maximum, or long-task evidence remains poor.

## Completion targets

The quick-win program is complete when, in five consecutive production-build runs on the baseline machine:

- the full matrix terminates without a scene watchdog;
- no required interaction or semantic mutation is missing;
- cold hover p95 ≤ 50 ms and warm hover p95 ≤ 32 ms;
- selection p95 ≤ 100 ms and snap/inference p95 ≤ 50 ms;
- simple creation p95 ≤ 250 ms and cumulative/native creation p95 ≤ 500 ms;
- Smart Dimension preview/mode changes p95 ≤ 50 ms, editor focus ≤ 100 ms, and dimension/constraint commit p95 ≤ 500 ms;
- native offset preview/commit p95 ≤ 500 ms;
- no main-thread task exceeds 100 ms;
- functional, persistence, undo/redo, geometry-tolerance, accessibility, and visual-feedback tests pass; and
- independent performance/dev-practice and design/UX auditors report no unresolved high-severity finding.
