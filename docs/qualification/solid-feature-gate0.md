# Solid feature Gate 0 qualification

- Date: 2026-08-25
- Scope: E3D-S1-01 and E3D-S1-02
- Kernel: pinned Monstertruck 0.4.0
- Candidate decision: **New Body Extrude may proceed for line/arc/circle regions. Join and Cut remain outside the Sprint 1 candidate.**

This record is deliberately narrower than a product capability claim. Native
tests exercise the public feature boundary plus direct Monstertruck curve
construction where the current DTO cannot carry curves. Release-WASM tests
exercise `crawler-feature-kernel` directly; they do not modify or substitute the
checked-in generated application runtime.

## E3D-S1-01 — Boolean decision

### Decision

Do not add Join or Cut to the Sprint 1 candidate. Native Monstertruck Boolean is
broader than the WASM boundary. Release WASM is qualified only for exact axis-
aligned rectangular-prism chains plus the explicitly tested identical,
disjoint, and tangent proof cases. Overlapping rotated or curved operands fail
closed with `ErrorCategory::Unsupported` and do not trap.

The selected follow-on path is to move generic Boolean execution to a boundary
where the native intersection backend is available, or contribute a WASM-safe
generic intersection backend. Expanding the bounded cell implementation is not
an acceptable substitute for curved Join/Cut.

### Capability matrix

| Fixture | Native union | Native difference | Release WASM | Structured outcome / note |
|---|---|---|---|---|
| Overlapping axis-aligned prisms | Supported | Supported | Supported | Exact bounded orthogonal-cell path is shared |
| Overlapping rotated prism + prism | Supported | Supported | Unsupported | WASM returns `Unsupported`; native intersection backend required |
| Extruded exact-rational circle + prism | Supported | Supported | Unsupported by source contract | Not eligible for Sprint 1 Join/Cut |
| Extruded line/arc capsule + prism | Supported | Supported | Unsupported by source contract | Not eligible for Sprint 1 Join/Cut |
| Disjoint bodies | Supported multi-shell | **Native returns `EmptyResult`** | Union and difference supported | Native difference is a kernel discrepancy; expected no-op semantics are not qualified |
| Contained rectangular tool | Supported | Supported void | Supported by qualified cell path | Axis-aligned only |
| Tangent rectangular contact | Supported | Supported no-volume-change | Supported | Exact axis-aligned proof case only |
| Identical target/tool | Union supported | `EmptyResult` | Same | Empty result is structured; no trap |
| Disjoint intersection | `EmptyResult` | n/a | `EmptyResult` | Structured empty result; no trap |
| Multi-shell result | Supported for disjoint union | n/a | Supported for disjoint union | Singular `BodySnapshot` may contain multiple boundaries |

Every test compares the caller-owned serialized input bytes before and after
execution. They remain byte-identical. A rejected generic Boolean does not
currently populate `FeatureError.preserved_inputs`; purity is proven by the
fixture comparison rather than returned preservation evidence. That is deferred
contract work and must not be represented as complete.

### WASM evidence boundary

`wasm-pack test --node --release` successfully compiled all release test WASM,
but its Cargo runner failed on this Windows host with OS error 193 while launching
its cached runner. Executing the same pinned `wasm-bindgen-test-runner 0.2.127`
directly against the produced release integration-test WASM passed 4/4. This is
real release-WASM kernel execution, but not generated application-runtime parity;
that remains for E3D-S1-14 and E3D-S1-15.

## E3D-S1-02 — Native curve-to-face decision

### Decision

Proceed with a V2 candidate limited to lines, trimmed circular arcs, and circles.
The curve DTO must preserve explicit parameter intervals, winding, and seams.
Circular arcs and circles normalize to Monstertruck's exact rational NURBS
representation; they must not be labeled as analytic `Circle` kernel variants.
A full circle uses two caller-stable semicircular edges/seams in the qualified
construction.

The DTO/migration boundary is therefore:

1. V1 polygon profiles remain V1 and are never silently promoted to exact V2.
2. V2 `Line`, `CircularArc`, and `Circle` normalize to native line or exact
   rational NURBS edges.
3. Other V2 curve tags require an explicit capability flag and fail before
   preview until separately qualified.
4. Display tessellation is derived evidence only and never modeling input.

### Curve matrix

| Curve class | Construction | Face / extrude / mesh / STEP | Candidate classification |
|---|---|---|---|
| Line | Native `Curve::Line` | Passed | Native |
| Trimmed circular arc | `Curve::NurbsCurve` from exact rational arc | Passed | Exact rational conversion |
| Circle | Two exact rational semicircular NURBS edges | Passed | Exact rational conversion; explicit seams required |
| Ellipse | Non-uniformly transformed exact rational circle | Passed in direct kernel probe | Exact rational conversion, deferred from Sprint 1 DTO |
| Elliptical arc | Representable by the same rational transform in principle | Not separately end-to-end qualified | Blocked/deferred |
| Rational conic | Kernel has rational NURBS representation | General conversion not qualified | Blocked/deferred |
| Control-point B-spline | Native `Curve::BsplineCurve` | Passed | Native kernel capability; deferred from Sprint 1 DTO |
| Normalized fit spline | No named canonical repo conversion | Not qualified | Unsupported for V2 candidate |

Changing tessellation tolerance changes display triangles but does not mutate the
serialized B-rep. Exact rational arc samples remain on the circle within
`1e-10`. STEP probes produce `MANIFOLD_SOLID_BREP` output for line, arc, circle,
ellipse, and control-point B-spline fixtures.

### Remaining acceptance gaps

E3D-S1-02 is complete only for the Sprint 1 line/arc/circle decision, not for the
initiative's full curve list. Separate work must qualify elliptical-arc trimming,
general rational conics, and a deterministic fit-spline conversion. Boolean
participation was exercised for line/arc and circle extrusions natively; the same
overlaps are intentionally unsupported in current WASM.

## Reproduction

```powershell
$env:CARGO_TARGET_DIR='target/gate0-agent'
cargo test -p crawler-feature-kernel --test gate0_capability_matrix -- --nocapture
cargo check -p crawler-feature-kernel --target wasm32-unknown-unknown --release

$env:CARGO_TARGET_DIR='target/gate0-wasm-pack'
wasm-pack test --node --release crates/crawler-feature-kernel
# Host runner reports OS error 193 after successful release compilation.
$runner = Get-ChildItem "$env:LOCALAPPDATA\.wasm-pack\wasm-bindgen-*\wasm-bindgen-test-runner.exe" |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$testWasm = Get-ChildItem "$env:CARGO_TARGET_DIR\wasm32-unknown-unknown\release\deps\gate0_wasm_boolean-*.wasm" |
  Select-Object -First 1
& $runner.FullName $testWasm.FullName
```

Observed results:

- native Gate 0 matrix: 4 passed, 0 failed;
- release-WASM Gate 0 matrix: 4 passed, 0 failed;
- release `wasm32-unknown-unknown` library check: passed; and
- at the Gate 0 checkpoint, no generated runtime or application file was changed
  by this qualification. Later Sprint 1 implementation and application-runtime
  parity use a separately locked generated artifact.
