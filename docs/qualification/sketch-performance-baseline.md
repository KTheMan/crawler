# Sketch performance baseline

- Status: remediation implemented; final full-matrix and release qualification pending
- Recorded: 2026-08-12; execution evidence updated 2026-08-13
- Scope: planar Sketcher creation, hover, selection, snap/inference, Smart Dimension, constraints, and retained curve operations
- Automation: [`../../web/crawler-app/tests/sketch-performance-matrix.spec.ts`](../../web/crawler-app/tests/sketch-performance-matrix.spec.ts)
- Remediation plan: [`../specs/sketch-performance-quick-wins.md`](../specs/sketch-performance-quick-wins.md)

## Purpose

This baseline converts reports of a laggy sketch workspace into repeatable browser-observable workloads. It is intentionally red while a workflow times out, misses an expected interaction response, creates a main-thread task over budget, or exceeds an action budget. A failed performance test is therefore evidence to investigate; it is not automatically a test defect.

The primary user workflow is a mild sketch: a two-point rectangle, a construction line across opposite corners, and a center-diameter circle, followed by selection and a midpoint constraint between the circle center and diagonal. The performance matrix splits this into a mild interaction scene and separate semantic-constraint cases; the complete end-to-end sequence is retained in the focused sketch lifecycle test. The matrix then adds native curves and composite generators to expose scaling and interaction failures.

## Reproducing the baseline

From `web/crawler-app`:

```powershell
pnpm run test:sketch-perf
```

### Durable production qualification

Run the production-build harness through its parent-process watchdog:

```powershell
cd web/crawler-app
pnpm run test:sketch-perf:qualified
```

Each risky group runs in its own Playwright/browser process tree. The parent records
`running` metadata before launch, forcibly terminates that tree at the deadline,
continues with later groups, and finalizes a checksummed result under
`docs/qualification/output/sketch-performance/<run-id>/`. The artifact identifies
the commit, dirty patch, production build hash, browser mode, host, configured sample
count, each scenario outcome, and durable per-test JSON/raw action probes. Playwright's
ephemeral `test-results` directory is not the evidence system of record.

Before trusting watchdog results, exercise the deliberately wedged renderer fixture:

```powershell
pnpm run build
pnpm run test:sketch-perf:watchdog
```

The command passes only if the parent kills the blocked child, runs the later child,
and writes the final checksum. Release percentile collection uses a warm-up followed
by at least 20 samples:

```powershell
$env:SKETCH_PERF_WARMUPS = "1"
$env:SKETCH_PERF_REPETITIONS = "20"
pnpm run test:sketch-perf:qualified
```

The browser probe derives the interacted SVG member's stable geometry and segment identity,
then accepts a class assertion only when that selector resolves to exactly one member. Each accepted sample includes its concrete geometry,
constraint, count, class, or attribute mutation proof; semantic latency; two-frame
stable-paint latency; and only long-task intervals overlapping that action window.

Run one isolated catalog case by exact name:

```powershell
$env:SKETCH_PERF_FILTER='line'
pnpm exec playwright test tests/sketch-performance-matrix.spec.ts `
  --grep "all sketch creation types" --workers=1 --reporter=line
```

Run one matrix family:

```powershell
pnpm exec playwright test tests/sketch-performance-matrix.spec.ts `
  --grep "mixed sketch combinations" --workers=1 --reporter=line

pnpm exec playwright test tests/sketch-performance-matrix.spec.ts `
  --grep "constraint, Smart Dimension" --workers=1 --reporter=line
```

The test attaches raw JSON for catalog, combination, and constraint/edit results. Console summaries are rankings for diagnosis, not substitutes for the raw samples.

## Measurement method

The matrix uses a fixed 1440 × 900 viewport, one Playwright worker, a fresh browser context for each independent scene, stable geometry identifiers, and deterministic plane-relative points. `Alt` suppresses automatic inference during controlled creation unless inference is the subject of the measurement.

Recorded environment:

| Property | Value |
| --- | --- |
| Host | CAD-STATION-2 |
| OS | Windows build 22621 |
| CPU | Intel Core i7-9700 at 3.00 GHz |
| Memory | approximately 64 GiB |
| Browser | Google Chrome 151.0.7922.109, headless |
| Graphics adapters | NVIDIA Quadro P620 and Intel UHD Graphics 630; headless mode does not establish representative GPU-composited user timing |
| Node / pnpm | 22.14.0 / 10.6.4 |
| Server | Vite development server at `127.0.0.1:4174` |
| Playwright mode | one worker, serial matrix, 1440 × 900 viewport |
| Repository identity | branch `alpha`, HEAD `d1372730ef9ae32b6a48f5862e107e58a2118a48`, dirty worktree |

The dirty worktree means HEAD alone does not reproduce the tested code, and an exact patch identity was not retained with the earlier results. The recorded numbers are therefore discovery evidence, not a certified release baseline. A release decision requires a production-build rerun with commit plus patch/build identity on the same host; the dev server can change absolute timing.

An initialization script installed before navigation records:

1. the browser input event timestamp;
2. the expected semantic DOM mutation, such as a geometry count or interaction class;
3. two subsequent `requestAnimationFrame` callbacks; and
4. browser `longtask` entries.

Reported action latency includes both input-to-semantic-mutation and input-to-stable-paint rather than Node-to-browser command duration. The harness writes the concrete mutation proof, raw timings, summary statistics, geometry/constraint counts, SVG size, and action-overlapping long-task intervals into durable per-child evidence. The parent writes metadata before launch, terminates a blocked OS process tree, continues later samples, and finalizes a checksummed aggregate. Missing samples are explicit violations rather than zero-duration successes.

“Stable paint” in this document means expected semantic DOM state followed by two animation frames. It is a presentation-readiness proxy, not proof that the GPU completed scanout. The durable JSON retains both semantic-mutation and stable-paint latency.

Isolated scenes reset long-task observation after sketch initialization. Combination scenes reset once before building the scene, so their long-task result includes every cumulative addition.

## Current coverage

Catalog assertions require every shipped draw tool and every declared creation variant to have a scenario:

- line, point, control-point spline, fit-point spline, ellipse, elliptical arc, conic, and text;
- two-point, three-point, and center rectangles;
- center-diameter, two-point, three-point, two-tangent, and three-tangent circles;
- center-point, three-point, and tangent arcs;
- inscribed, circumscribed, and edge polygons; and
- center-to-center, overall, center-point, and three-point-arc slots.

The combination matrix includes:

- rectangle + construction diagonal + circle;
- the mild scene + center-point arc;
- the mild scene + ellipse;
- the mild scene + control-point spline;
- the mild scene + arc + six-sided polygon + three-point-arc slot;
- two-line Smart Dimension angle preview and commit;
- midpoint, tangent, equal, concentric, and point-on-object constraint workflows; and
- retained offsets of control/fit splines, ellipses, elliptical arcs, and conics.

Catalog cases measure creation for every type. Primitive line/circle/arc cases also exercise hover, selection, and snap. The mild combination is the full-interaction checkpoint; heavier combinations are creation/size/long-task checkpoints to avoid conflating interaction-probe failures with scene-construction completion. A whole-scene watchdog identifies the failing mixed scene, not the exact addition or subsystem responsible.

| Workload family | Creation | Hover | Selection | Snap | Smart Dimension | Long task |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Isolated line/circle/arc | yes | yes | yes | yes | no | scenario max |
| Other isolated tools/variants | yes | no | no | no | no | scenario max |
| Mild full-interaction scene | scene build plus final-click samples | yes | additive | yes | activation | full scene max |
| Four heavier combination scenes | added-shape final-click latency only | no | no | no | no | full scene max |
| Constraint/edit scenes | supporting creation plus semantic action | no | operand selection only | no | angle/constraint/edit action | full scene max |

## Current implementation and focused-run evidence

Phases 0 through 5 of the remediation plan are implemented and have received their
phase-local independent audits. The remaining work is the final corrected full-matrix
run, the 20-sample release percentile run, and the program-level performance/dev and
design/UX audits. Nothing in this section is a release qualification claim.

### Current production evidence (2026-08-13)

#### Final complete production matrix

The audited production-build runner completed **210/210 independent child processes**:
all 26 creation shapes/variants, five mixed scenes, and 11 constraint, Smart Dimension,
and retained-offset actions passed **5/5**. Every timed row produced semantic and
two-frame stable-paint samples; no action window overlapped a main-thread long task.

- Artifact: `web/crawler-app/output/final-full-matrix-five-release/2026-08-13T13-56-14-607Z-18648dfc/results.json`
- SHA-256: `20c2d2463ae2a673c55c9b84d2eb94372175ca70d5f1697ef276fa10ef63fdeb`
- Exact mild scene: semantic/stable-paint p95 **44.8/56.6 ms**.
- Midpoint, two-line Smart Dimension angle, tangent, equal, concentric, and point-on-object actions: stable-paint p95 **49.1/48.6/53.0/49.4/52.3/61.6 ms**.
- Retained control-spline, fit-spline, ellipse, elliptical-arc, and conic offsets: stable-paint p95 **63.8/118.6/50.7/53.1/92.4 ms**.
- All final rows stayed below the documented triage ceilings; scenario-wide long tasks remain recorded as environmental/setup context, while the gate uses only intervals that overlap the measured action.

The earlier two-point-circle scene-wide outlier was separately rerun for 20 independent
measured processes and passed **20/20**, semantic/stable-paint p95 **26.8/60.4 ms**, with
no action-overlapping long task:
`web/crawler-app/output/release-circle-two-point-20/2026-08-13T13-50-19-887Z-a07fe883/results.json`.
This targeted release sample does not imply that every matrix row has 20-sample release
coverage; the complete program matrix is the explicit five-sample qualification above.

Unless noted otherwise, each qualified row is one warm-up plus five independent
measured production-preview browser processes. Percentiles combine all of the named
target's recorded action probes; the durable JSON retains the individual probe labels,
semantic proofs, stable-paint samples, and action-overlapping long tasks.

| Target | Result | Semantic p95 | Stable-paint p95 | Action long-task max | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| Mild rectangle + construction diagonal + circle | 5/5 passed; 55 semantic and 55 stable samples | 50.3 ms | 66.2 ms | 0 ms | `web/crawler-app/output/final-program-mild-clean/2026-08-13T09-24-48-628Z-ed9f1314/results.json` (SHA-256 `80ccd15705c8018a72122361a7d085f4a4bb36cc74e57f27f420ec3a42c00ae6`) |
| Exact mild midpoint workflow | 5/5 passed; diagonal and circle-center operands were selected additively and the midpoint mutation was proved | 40.2 ms | 61.4 ms | 0 ms | `web/crawler-app/output/final-midpoint-corrected-qualified/2026-08-13T08-10-36-893Z-246d5f0a/results.json` |
| Two-segment Smart Dimension angle preview and commit | 5/5 passed; 20 semantic and 20 stable samples | 27.1 ms | 49.9 ms | 0 ms | `web/crawler-app/output/final-smart-angle-one-paint/2026-08-13T08-41-04-578Z-a850bbc8/results.json` |
| Certified ellipse offset preview and commit | 5/5 passed; two total public geometry entities and 27 SVG nodes | 38.8 ms | 57.2 ms | 0 ms | `web/crawler-app/output/final-certified-ellipse-qualified/2026-08-13T09-00-14-021Z-0efacfa4/results.json` |
| Certified elliptical-arc offset | 5/5 passed | 45.6 ms | 50.9 ms | 0 ms | `web/crawler-app/output/phase5-qualified-action-10/2026-08-13T09-09-19-486Z-31c1d159/results.json` |
| Certified conic offset | 5/5 passed | 37.6 ms | 84.1 ms | 0 ms | `web/crawler-app/output/phase5-qualified-action-11/2026-08-13T09-10-42-883Z-af954836/results.json` |

The clean mild run's raw per-process action results put cold hover at 21--34 ms,
warm-hover p95 at 25--46 ms, selection at 16--34 ms, snap at 25--47 ms, and Smart
Dimension activation at 14--29 ms, with no action-overlapping long task. The aggregate
stable-paint p95 is higher because it combines creation and interaction probe kinds; it
must not be substituted for an individual hover budget.

Before the final complete matrix, the independent Phase 5 audit also ran the canonical worker preview path directly with
one warm-up and five repetitions for every retained native-curve source. Its observed
stable-paint p95 / maximum action long task was: control-point spline 49.1/50 ms,
fit-point spline 79.6/59 ms, ellipse 61.5/0 ms, elliptical arc 56.2/0 ms, and conic
52.9/0 ms. The corresponding audit run roots are
`web/crawler-app/output/phase5-audit-4200` through `phase5-audit-4204`. At that
checkpoint, parent-runner qualification for actions 7 and 8 was incomplete due to fixed
preview-port conflicts. The final complete matrix above supersedes that infrastructure
limitation and passes actions 7--11 at 5/5.

### Implemented remediation and audit facts

- The production harness now uses visible pinned/flyout tool activation, exact geometry
  selectors, explicit Control-key additive selection, semantic mutation plus two-frame
  stable-paint proof, action-scoped long tasks, checksummed durable artifacts, and a
  killable parent-process watchdog whose deliberate renderer-wedge fixture passed an
  independent audit.
- Diagnostics coalesce obsolete generations before calculation, reuse per-entity
  sampling and bounds, reject noncandidate pairs through broad phases, and preserve the
  reference diagnostic set and deterministic ordering.
- Overlay participation, solve-component, retained-operation, and suppression data are
  indexed once per revision. Pointer-only frames update transient feedback, preserve the
  latest event, and avoid stable-layer and inspector reconstruction when semantic state
  is unchanged.
- Connected-offset discovery is linear in geometry plus endpoint incidence and includes
  a 3,000-ray shared-endpoint adversarial test.
- The certified native offset backend accepts analytic primitives, single-span clamped
  degree-1--3 Bezier control splines, Catmull-Rom fit splines, affine ellipses and
  elliptical arcs (including reversed direction), and polynomial quadratic conics with
  weight exactly 1. Unsupported multi-span B-splines, rational conics with other
  weights, singular/cusped inputs, extreme coordinates, and configured bound/complexity
  overflows return typed errors rather than an uncertified commit.
- Ellipse and elliptical-arc offsets are exposed as one editable multi-span cubic
  B-spline result entity rather than hundreds of public linear entities. Certification
  remains analytic; sampling is not used to accept a result.
- The independent Phase 4B audit reproduced and closed clockwise-sweep, integer-overflow,
  and topology-to-result-ID findings. Dense 65,537-sample checks remained below the
  conservative certificate: skew ellipse offsets measured 127.075 nm and 135.209 nm
  against 361.290 nm bounds; counterclockwise and clockwise quarter arcs measured
  4.424 nm and 5.343 nm against 483.951 nm bounds. Exact extreme-coordinate inputs now
  reject without panic, and result interval IDs remain stable across a 32-to-39 interval
  topology change.
- Phase 5 uses the existing worker bridge for a deep-frozen, ownership-guarded canonical
  preview batch with abort and generation/ID/revision guards. Accept is atomic and
  single-use, creates one history entry, performs no second worker call, and submits only
  the durable canonical operation commands.

The current TypeScript unit suite passes 174/174, the Rust offset suite and documentation
tests pass, the sketch lifecycle suite passes 13/13, focused pointer/Smart Dimension
Playwright tests pass, and the production build succeeds. The final full matrix and both
independent final audits also pass; universal 20-sample release coverage remains
explicitly outside the five-sample program claim.

## Historical and superseded evidence

Everything below this heading records discovery and intermediate runs. It is retained
for before/after traceability, but it does not describe the current implementation and
must not override the current production evidence above.

### Historical 2026-08-13 quick-win execution update (superseded)

The earlier native-creation watchdogs were traced to benchmark actionability rather
than sketch computation: the test tried to click hidden, unpinned ribbon controls.
The current harness invokes pinned tools directly and all other draw tools through
the visible **Draw** flyout. An independent harness audit reproduced the old stop
before product tool activation and verified the corrected production workflow.

Five independent measured production-preview processes now pass for the highest-value
creation scenes (one additional warm-up per target):

| Target | Passes | Semantic samples / p95 | Stable-paint p95 | Action long-task max | Durable artifact |
| --- | ---: | ---: | ---: | ---: | --- |
| Mild rectangle + construction diagonal + circle | 5/5 | 55 / 54.3 ms | 70.0 ms | 0 ms | `web/crawler-app/output/final-targeted-mixed-1-qualified/2026-08-13T07-08-55-051Z-1fc46763/results.json` |
| Mild scene + ellipse | 5/5 | 15 / 48.7 ms | 67.5 ms | 0 ms | `web/crawler-app/output/final-targeted-mixed-3-qualified/2026-08-13T07-09-50-483Z-83ec0d32/results.json` |
| Mild scene + control-point spline | 5/5 | 15 / 56.5 ms | 130.7 ms | 0 ms | `web/crawler-app/output/final-targeted-mixed-4-qualified/2026-08-13T07-10-43-032Z-a8698cf1/results.json` |

These are qualification diagnostics, not release percentile evidence: the release
contract still requires 20 measured processes, and control-spline stable paint remains
above the 100 ms cumulative/native completion target.

The corrected harness also exposed a real remaining offset cost center. A production
control-spline retained-offset probe completed rather than timing out, but its preview
was 4,401.6 ms with a 4,395 ms main-thread long task; commit was 158.5 ms. The raw
artifact is `web/crawler-app/output/final-offset-control-prewasm/2026-08-13T07-15-38-733Z-bbc20d9f/results.json`.
At that intermediate point, the UI-side native offset approximation duplicated the
canonical backend generator. Phase 5 has since replaced that path with canonical worker
preview and atomic accept.

Completed local cost signals and correctness gates:

- diagnostics generations coalesce and stale work is skipped before calculation;
- diagnostic sampling/bounds are reused with deterministic reference equivalence;
- render participation/solve/operation indexes are built once per revision;
- pointer-only frames preserve the latest pointer while skipping stable SVG generation;
- connected-offset expansion is linear in geometry plus endpoint incidence, including
  a 3,000-ray shared-endpoint adversarial test; and
- the then-current TypeScript unit suite passed 171/171 (the current suite is 174/174).

At this intermediate checkpoint, general adaptive curves rejected with a typed error.
The later certified curve families and completed primitive overflow/large-coordinate
audit are recorded in the current section above.

### Historical qualified production rerun after diagnostic broad-phase work (superseded)

The production parent runner completed one warm-up plus five independent measured processes for each previously blocking native-curve combination. The watchdog was not increased:

| Target | Measured result | Durable artifact |
| --- | --- | --- |
| Mild scene + ellipse | 0/5 passed; every measured process reached the 20,000 ms inner scene watchdog before the target creation mutation produced a stable probe | `output/sketch-performance/2026-08-13T05-23-56-856Z-c07d5d71/results.json` (SHA-256 `ec7718db5a01c7fbac0ccbb0e6f3cd4a221f61242b5029e989f3dd1588d59644`) |
| Mild scene + control-point spline | 0/5 passed; every measured process reached the 20,000 ms inner scene watchdog before the target creation mutation produced a stable probe | `output/sketch-performance/2026-08-13T05-24-36-559Z-7197b052/results.json` (SHA-256 `597f6dd05832d4c193c63e426fe1dc8764a3d2a60c3a41e2c1d36a084bbece30`) |

Both legacy aggregates retain empty semantic/stable raw sample arrays and red child statuses. Their pre-hardening summary fields incorrectly contain `0` for the empty p95; that evidence-integrity defect is fixed in the current harness, where empty percentiles serialize as `null` with explicit sample counts. The child stdout/stderr and parent metadata remain beside each aggregate. The failures show the diagnostic broad phase is not sufficient by itself to resolve the production stall and keep the render/pointer and generated-geometry phases open.

The Playwright statuses inspected during this documentation pass are red:

- Historical pre-hardening artifact: a filtered `line` workflow completed creation, hover, and snap but failed because selection produced no sample. That older class probe checked the first matching DOM element. The current probe requires the interacted geometry/segment selector to resolve uniquely; a subsequent focused production line run produced exact creation, hover, selection, and snap mutation proofs.
- Persisted failure artifact plus contemporaneously observed success row: the current constraint/edit run completed only the two-line Smart Dimension angle workflow (p50 31.8 ms; p95/max 80.8 ms; two geometry, one constraint, 44 SVG nodes, no long task). Midpoint, tangent, and equal did not produce the expected semantic result within five seconds; concentric failed during arc creation; point-on-spline exceeded the 15-second scenario watchdog; and all five native-curve retained-offset scenarios exceeded the 15-second end-to-end workflow watchdog. The watchdog includes setup, selection, preview, and commit, so it does not attribute all 15 seconds to offset computation. The exact successful row was independently observed but its raw attachment was not retained.

No complete raw JSON artifact from the earlier full matrix remains in `test-results`; Playwright output was overwritten by later focused runs. Consequently, the measurements below are explicitly provisional discovery evidence reconstructed from the qualification session's console output and notes.

## Historical provisional discovery evidence (superseded)

Measurements vary with machine load. The values below are the observed ranges or exact representative run from the 2026-08-12 qualification session; they are not universal hardware claims.

### Responsive controls

| Workload | Observed result | Interpretation |
| --- | ---: | --- |
| Isolated line creation | 55–68 ms | Creation itself is responsive. |
| Isolated line hover stable paint | 43–49 ms | Near the desired 50 ms hover target. |
| Isolated line snap stable paint | 29–53 ms | Generally responsive in isolation. |
| Isolated line long task after scoped reset | 0 ms | Initialization is no longer mixed into the action result. |
| Two-line Smart Dimension angle, earlier run | p50 32.1 ms; p95/max 103.9 ms | Historical result; the current independently observed run is recorded above. |
| Focused mild midpoint lifecycle test | passed in 5.1 s test runtime | The exact functional workflow remains automatable independently of the performance matrix. |

The isolated line selection probe currently produces no sample and fails explicitly. It is not a measured zero-millisecond selection and is not yet attributable solely to product behavior.

### Mild full-interaction checkpoint

| Metric | Representative result |
| --- | ---: |
| Post-probe geometry / constraints | 8 / 11; this is not the pristine six-entity scene size |
| SVG nodes / markup | 178 / 97.2 KiB |
| Cold hover | 17.2 ms |
| Warm hover p95 | 42.1 ms |
| Smart Dimension activation | 29.8 ms |
| Additive selection / snap | no sample; explicit violation |
| Maximum long task | 0 ms in the representative run |

The missing additive-selection and snap samples make this checkpoint red even though the observed hover and Smart Dimension timings were responsive.

### Mixed combinations

| Combination | Result |
| --- | --- |
| Mild scene + center-point arc | Completed; added-arc creation 29.8 ms, 7 geometry, 9 constraints, 110 SVG nodes, 56.9 KiB markup. |
| Mild scene + ellipse | Exceeded the 20,000 ms scene watchdog. |
| Mild scene + control-point spline | Exceeded the 20,000 ms scene watchdog. |
| Mild scene + arc + polygon-6 + arc slot | Exceeded the 20,000 ms scene watchdog. |

These timeouts were observed in fresh browser contexts, which reduces contamination from the preceding scene. Because their raw artifacts were not retained, they remain provisional until the production baseline rerun.

### Constraint and retained-edit matrix

The Smart Dimension angle scenario completed. In the current matrix run, midpoint, tangent, equal, concentric, point-on-object, and all five retained-offset workflows failed to complete their automation within the 15,000 ms per-workflow watchdog or failed to produce the expected mutation. These rows must remain classified as timeout/automation failures until operand selection and action completion are independently confirmed; they are not valid latency samples.

Before watchdog hardening, exploratory runs reported multi-second retained-offset actions:

| Retained offset source | Exploratory action latency / maximum long task |
| --- | ---: |
| Control-point spline | approximately 4,698 / 4,690 ms |
| Fit-point spline | approximately 2,479 / 2,466 ms |
| Ellipse | action observed as high as approximately 9,299 ms; long task at least 737 ms |
| Elliptical arc | approximately 1,054 / 1,048 ms |
| Conic | approximately 1,024 / 1,017 ms |

These values have no surviving raw attachment and include a known possible ellipse action-probe mismatch. They identify a high-priority area but must be re-baselined after the constraint/edit workflow becomes reliably automatable.

## Current budgets

The matrix presently fails above:

| Signal | Budget |
| --- | ---: |
| Creation stable paint | 1,500 ms |
| Hover p95 | 250 ms |
| Selection p95 | 250 ms |
| Snap p95 | 250 ms |
| Maximum main-thread long task | 100 ms |
| Constraint/dimension p95 | 500 ms |

These are triage ceilings, not the final product targets. The remediation plan uses stricter interaction targets once missing-sample and timeout failures are eliminated.

The direct exploratory test can use a small repetition count to keep a red matrix bounded. The qualified parent runner defaults to one warm-up plus five independent measured child processes per target; release qualification requires one warm-up plus at least 20 measured processes.

## Known limitations

- Direct exploratory runs may use small interaction counts. Qualified percentiles are aggregated only from independent measured children, excluding warm-ups; five samples are diagnostic evidence and 20 are required for release qualification.
- Creation timing begins before the final placement click; it excludes tool activation, variant setup, and earlier point collection.
- Creation-only combination timing sums the added shapes' final-click latencies, not total wall time to build the scene.
- Combination scenes are independent mixed scenes, not one progressive density series.
- The scenario-wide maximum long task remains useful context, while each action probe separately retains only overlapping long-task intervals.
- Headless production-preview results do not represent headed GPU-composited usage; system load and thermal state remain environmental variables.
- The direct test's in-page watchdog cannot interrupt blocked renderer JavaScript. Qualified runs rely on the parent OS process-tree deadline, whose deliberately blocking fixture is a required self-test.
- The fixed `PERF` text payload and exact generated entity count are implementation-coupled and do not cover text-length scaling.
- The current catalog is exhaustive only against the shipped draw-tool and variant manifests. It is not exhaustive over polygon cardinality, text length, constraint density, modify/project operations, or every pairwise combination.

## Historical evidence-supported cost centers (remediated)

The initial code inspection identified four mechanisms consistent with the observed
scaling. Phases 1--5 subsequently remediated these mechanisms; the list is retained as
the causal record rather than as a description of the current hot path:

1. `selfIntersectionDiagnostics()` is pairwise across geometry. It currently resamples both entities inside every pair and compares every sampled segment pair. Circles and native curves contribute roughly 48–64 segments each.
2. Deferred diagnostic generations are discarded only after their full calculation. Rapid mutations can therefore leave obsolete expensive jobs consuming the main thread.
3. `renderSketchOverlay()` rebuilds all layer markup before keyed reconciliation. For every geometry it linearly searches solve components and scans every constraint with `JSON.stringify` to calculate participation.
4. Native offset adaptively subdivides a source curve into many degree-1 spline entities and adds an offset constraint per interval. The generated geometry, solver work, diagnostics, DOM, and retained-operation metadata amplify one another.

These are hypotheses supported by code shape and reproduced symptoms. Each remediation must be profiled and benchmarked independently before causality is claimed.

## Interpretation rules

- Do not average a timeout into successful samples.
- Do not convert a missing interaction sample to zero.
- Do not loosen a budget to make the gate green.
- Do not use `window.__crawlerApp.sketchDraft()` inside a timed interval; it clones the draft.
- Do not claim a constraint is slow until the expected constraint mutation is observed.
- Compare production-build results on the same machine and browser configuration before and after a change.
- Preserve raw JSON and failing traces for any accepted performance change.
