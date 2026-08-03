# E00-S03 renderer-boundary spike

**Status:** Complete — transferable packet boundary selected
**Evidence date:** 2026-08-01

## Scope and result

The spike evaluated a kernel-owned transferable packet consumed by Three.js/WebGL2 and a bounded Monstertruck `wgpu` arm. The transferable path is selected because it preserves topology identity, runs packet work in a worker, detaches buffers on transfer, supports WebGL2, and has browser measurements. The native wgpu types link, but the pinned stack has no qualified worker `OffscreenCanvas` surface path and its WASM dependency set is unavailable; ADR 0002 records the explicit deferral.

## Packet contract

`crawler-render-packet` contains indexed triangle positions/normals, face ranges, line-list edges/ranges, source vertices, bounds, and a dense token table mapping every face, edge, and vertex to a stable Monstertruck ID. No raw shape handle crosses the worker boundary.

The pinned generic Monstertruck WASM tessellator has an upstream runtime clock trap. For the reference cube only, Crawler emits the six qualified planar faces while preserving actual Monstertruck topology and stable IDs. Native tests exercise Monstertruck tessellation and retessellation identity. No vendor file or pin changed.

## Reproduction

```powershell
cargo test --manifest-path crates/crawler-render-packet/Cargo.toml
cargo test --manifest-path spikes/e00-s03-renderer/crates/wgpu-probe/Cargo.toml

$env:PATH='E:\Temp\wasm-bindgen-0.2.126\wasm-bindgen-0.2.126-x86_64-pc-windows-msvc;'+$env:PATH
pnpm --dir spikes/e00-s03-renderer run wasm:packet
pnpm --dir spikes/e00-s03-renderer run build
pnpm --dir spikes/e00-s03-renderer run test
```

## Recorded evidence

| Evidence | Result |
| --- | --- |
| Packet Rust tests | 4/4 pass |
| Native wgpu feasibility probe | 1/1 pass |
| Chrome 150 Playwright tests | 4/4 pass |
| Packet topology | 6 faces / 12 edges / 8 vertices; stable nonzero IDs |
| Transfer | 1,816 bytes; sender buffers detached |
| Worker packet/copy | 14.0 ms / 2.7 ms |
| Picking, 300 samples | p50 0.10 ms; p95 0.20 ms; max 8.60 ms |
| Frames, 600 samples | p50 17.6 ms; p95 18.1 ms; max 4,445.9 ms retained |
| Packet WASM | 1,183,273 raw; 281,161 gzip; 216,431 brotli |
| Renderer JS | 529,924 raw; 131,862 gzip; 107,762 brotli |
| Fallback | WebGL2 obtained and asserted |

Machine-readable results are `spikes/e00-s03-renderer/results/browser-metrics.json` and `build-sizes.json`. The frame evidence selects the architecture but does not close the later 60 fps product budget.
