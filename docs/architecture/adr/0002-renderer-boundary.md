# ADR 0002: Renderer boundary

- **Status:** Accepted
- **Date:** 2026-08-01
- **Decision owners:** Crawler part-design alpha

## Context

Crawler needs interactive rendering and topology selection without exposing mutable kernel handles to the main browser thread. The boundary must preserve stable face, edge, and vertex provenance, support worker transfer, and keep modeling independent of a renderer implementation.

## Decision

Adopt the versioned transferable `crawler-render-packet` boundary and Three.js/WebGL2 for the alpha viewport:

1. Modeling, stable-ID assignment, and packet construction remain in a dedicated worker.
2. The worker emits typed arrays for triangles, edges, vertices, bounds, range tables, and dense-token-to-stable-ID provenance.
3. Array buffers transfer ownership; kernel topology objects never cross the boundary.
4. Picking resolves renderer hits through packet tokens rather than renderer object identity.
5. WebGL2 is the supported fallback and alpha renderer.
6. Monstertruck `wgpu` is deferred. Its native scene/render types link, but the pinned stack does not expose a qualified worker `OffscreenCanvas` surface path and its WASM arm requires an unavailable `wgpu-core-deps-wasm v29.0.4`. Adding a second unmeasured renderer would not improve the selected boundary.

The pinned Monstertruck runtime can construct the cube and assign topology IDs on WASM, but its generic tessellator still traps on an upstream `std::time::Instant` call. The WASM reference fixture therefore uses a bounded Crawler planar-cube packet adapter with actual Monstertruck topology IDs. Native packet qualification continues through the full Monstertruck tessellator. The adapter is removed only after a promoted kernel runtime gate passes.

## Evidence

Debug/dev profiles only were used.

- `crawler-render-packet`: 4/4 Rust contract tests pass; native retessellation preserves face/edge/vertex IDs.
- Native bounded wgpu probe: 1/1 test passes.
- Production Vite build succeeds. The shipped packet WASM is 1,183,273 bytes raw, 281,161 gzip, and 216,431 brotli. The renderer JS is 529,924 bytes raw and 131,862 gzip.
- Chrome 150 Playwright suite: 4/4 tests pass, including WebGL2 fallback and stable face, edge, and vertex picks from one viewport.
- The worker transferred 1,816 bytes and all sender buffers detached. Packet construction took 14.0 ms and WASM-to-JavaScript copying 2.7 ms in the recorded run.
- Across 300 pick samples, latency was p50 0.10 ms, p95 0.20 ms, max 8.60 ms.
- Across 600 headless frame intervals, p50 was 17.6 ms and p95 18.1 ms. The 4,445.9 ms maximum is retained as a headless startup/outlier rather than omitted.

Reproducible evidence is stored under `spikes/e00-s03-renderer/results/`.

## Consequences

- Modeling code is insulated from Three.js and a future renderer.
- Stable topology selection survives retessellation at the packet contract level.
- Packet schema changes require a version bump and coordinated worker/renderer update.
- Duplicate triangle, edge, and vertex buffers trade memory for simple ownership and deterministic selection.
- The recorded headless frame result does not yet prove the M1 60 fps interaction budget; E01-S03 retains that gate.