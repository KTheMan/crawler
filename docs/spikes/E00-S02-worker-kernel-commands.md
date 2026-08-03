# E00-S02 worker-hosted kernel command spike

- Status: Complete; M1 bridge verified in Rust, Node, and Chrome
- Depends on: E00-S01
- Scope: Protocol and worker proof only; no application-shell or renderer work

## Question

Can Crawler run the qualified Rust/WASM kernel behind a dedicated browser worker
with versioned typed messages, cancellation, stale-result rejection, and
measured reference-cube round trips?

## Bounded implementation

1. Add a minimal Rust/WASM adapter that accepts a versioned command envelope and
   returns typed event envelopes. It may expose only health, build-reference-cube,
   tessellate-reference-cube, and cancel commands.
2. Host the module in a dedicated module worker. Keep document and kernel state
   inside the worker; the main-thread harness owns only request bookkeeping.
3. Give every command `protocol_version`, `request_id`, `document_revision`, and
   `preview_generation`. Events repeat those fields and use explicit accepted,
   progress, result, cancelled, and error variants.
4. Track the newest request per document revision on the receiver. Discard a
   result when its revision is no longer current or a newer preview generation
   exists.
5. Make cancellation observable and deterministic. Check cancellation between
   adapter phases. If an individual kernel call cannot cooperate, terminate and
   recreate the worker, restore the last acknowledged state, and report that
   path separately.
6. Measure warm and cold reference-cube round trips with transferred bytes,
   serialization time, kernel time, and end-to-end time. Record the browser,
   device, build revision, sample count, and p50/p95.

## Required evidence

- An unknown protocol version fails closed with a typed compatibility error.
- A reference cube completes without running kernel work on the main thread.
- A long-running fixture emits a cancelled event and does not change acknowledged
  document state.
- A deliberately delayed older preview cannot replace a newer preview result.
- Result payloads use transferables where applicable and report transferred byte
  counts.
- The measured evidence and reproduction command are checked into the spike.

## Explicit exclusions

- No workspace UI, feature timeline, renderer selection, persistence, or general
  document schema.
- No raw `monstertruck-wasm` shape handles crossing the worker boundary.
- No claim that cancellation interrupts an arbitrary in-progress kernel call
  unless the measurement demonstrates it.

## Current implementation and evidence (2026-08-01)

Both module-worker entries load the dev-generated `WasmKernelAdapter`; the former
JavaScript cube fixture is not used. The worker converts mesh JSON to
`Float32Array` and `Uint32Array` and transfers both backing buffers. The host
yields between cancellable phases, and receiver-side generation gating rejects
deliberately out-of-order results.

The M1 bridge adds `extrude_rectangular_prism` with stable document, operation,
and feature identities; exact integer `width_nm`, `height_nm`, and `distance_nm`;
a monotonic preview generation; and an explicit `new_body` behavior. Successful
results echo exact dimensions and bounds plus a qualified triangle-list layout
(`position.xyz`, `uv.xy`, `normal.xyz`, `uint32` indices) and transferred-byte
count. Invalid input, unsupported boolean-like modes, numerical range failures,
cancellation, and internal failures have stable codes and field/recovery context.
Acknowledged document state changes only after a successful mesh result.

The pinned Monstertruck stack constructs the exact B-rep on WASM. Its generic
WASM tessellator remains behind the documented runtime gate, so Crawler owns the
explicit rectangular-prism triangle adapter there; native qualification continues
to invoke Monstertruck tessellation. No vendor file or pin changed.

### Reproduction

```powershell
$env:CARGO_TARGET_DIR=(Resolve-Path crates/crawler-kernel-worker).Path+'\target'
$env:CARGO_NET_OFFLINE='true'
cargo test --manifest-path crates/crawler-kernel-worker/Cargo.toml

$tool='E:\Temp\wasm-bindgen-0.2.126\wasm-bindgen-0.2.126-x86_64-pc-windows-msvc'
$env:PATH=$tool+';'+$env:PATH
Push-Location crates/crawler-kernel-worker
wasm-pack build --dev --target web --out-dir ../../web/worker-spike/generated
Pop-Location

node --test web/worker-spike/worker-spike.test.mjs
node scripts/measure-worker-browser.mjs
```

No release build or workspace-wide formatter is part of this evidence.

### Verified evidence

- Seven native Rust tests pass, including edited-dimension bounds, exact
  transferable-byte accounting, cancellation, and invalid/unsupported failures
  preserving acknowledged state.
- The official `wasm-bindgen` 0.2.126 tool regenerated the dev binding after a
  successful `wasm32-unknown-unknown` build.
- Eight Node worker tests pass through the real generated binding. M1 tests prove
  dimension edits change exact metadata and typed-array bounds, invalid,
  unsupported, and numerical failures preserve acknowledged state, cancellation
  does not acknowledge state, and a delayed older preview is rejected.
- `web/worker-spike/measurement-browser.json` is fresh Chrome 150 M1 extrusion
  evidence with exact 10 x 20 x 30 mm bounds, 10 cold and 10 warm samples, and
  912 transferred bytes. Cold end-to-end p50/p95 measured 41.7/175.9 ms and warm
  p50/p95 measured 1.3/85.0 ms; the warm p95 outlier is retained rather than
  filtered. Warm kernel p50/p95 measured 0.6/0.6 ms.

The browser harness now issues the M1 extrusion and validates its qualified typed
arrays, exact bounds, and p50/p95 fields. The checked-in command uses an ephemeral
local HTTP port and Chrome DevTools Protocol so it does not depend on an extension
or a pre-existing development server.
