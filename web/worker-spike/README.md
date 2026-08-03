# E00-S02 worker-hosted kernel spike

This spike keeps reference-cube and rectangular-prism extrusion work behind a
dedicated module-worker boundary. `protocol.mjs` rejects stale results on the receiver.
`worker-client.mjs` first requests cooperative cancellation and recreates a
blocked worker after a bounded timeout, reporting `worker_restart` separately.

Both worker entries load the dev-generated `WasmKernelAdapter` from
`generated/`; the former JavaScript cube fixture has been removed. Mesh JSON is
converted to transferable `Float32Array` and `Uint32Array` buffers inside the
worker, and no raw kernel handles cross the boundary.

The real Rust/WASM worker path is qualified in native, Node, and Chrome tests.
Monstertruck constructs the solid; a bounded Crawler-owned WASM rectangular-prism
tessellation adapter covers the pinned runtime gate. The checked-in Chrome 150
evidence measures the M1 extrusion with exact 10 x 20 x 30 mm bounds. See the
E00-S02 spike document for commands, measurements, and evidence boundaries.

## Reproduce

```powershell
cargo test --manifest-path crates/crawler-kernel-worker/Cargo.toml
node --test web/worker-spike/worker-spike.test.mjs
node web/worker-spike/measurement.mjs
node scripts/measure-worker-browser.mjs
```
