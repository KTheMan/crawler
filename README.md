# Crawler

Crawler is a browser-based, desktop-class parametric CAD application. It uses
[`monstertruck`](https://github.com/KTheMan/monstertruck) as its geometry kernel
and targets WebAssembly for local, responsive modeling.

The [product requirements document](docs/PRODUCT_REQUIREMENTS.md) is the product
baseline. Build sequencing, implementation status, epics, and acceptance-ready
stories live in the [implementation backlog](docs/BACKLOG.md).

## Clone

```sh
git clone https://github.com/KTheMan/crawler.git
cd crawler
git submodule update --init vendor/monstertruck
git -C vendor/monstertruck submodule update --init resources
```

Monstertruck also declares a documentation-only `.blueprints` submodule whose
remote is currently unavailable. It is not required to build the kernel, so the
bootstrap commands initialize the required geometry resources explicitly.

For an existing clone without the kernel checked out:

```sh
git submodule update --init vendor/monstertruck
git -C vendor/monstertruck submodule update --init resources
```

The kernel is pinned at `vendor/monstertruck`. Update it deliberately and test
the complete modeling vertical slice before advancing the submodule commit.

## Kernel contract

The accepted kernel baseline and promotion policy are recorded in
[ADR 0001](docs/architecture/adr/0001-monstertruck-kernel-baseline.md). Run the
complete pin, native-contract, and WASM-compilation gate from PowerShell:

```powershell
./scripts/qualify-kernel.ps1
```

The executable contract is Crawler-owned and does not modify the pinned
Monstertruck submodule. Architecture decisions are indexed in
[`docs/architecture`](docs/architecture/README.md).

## Part-design alpha

The browser application lives in `web/crawler-app`. Install its local toolchain,
then build or run the browser contracts:

```powershell
pnpm --dir web/crawler-app install --store-dir .pnpm-store
pnpm --dir web/crawler-app build
pnpm --dir web/crawler-app test
```

The checked-in worker binding is generated from the current Rust runtime with
the pinned `wasm-bindgen` 0.2.126 CLI before browser qualification:

```powershell
./scripts/generate-part-runtime.ps1
```

Worker and renderer contract bindings are regenerated with the same pinned CLI:

```powershell
./scripts/generate-contract-bindings.ps1
```

The app supports canonical `.crawlerpart` ZIP New/Open/Save As workflows,
OPFS-preferred autosave and recovery with IndexedDB fallback, immutable STEP/STL/OBJ export, offline PWA
startup, keyboard command search, and the history-first browser/viewport/
inspector/timeline workspace.

Run the integrated native, WASM, protocol, and browser qualification from the
repository root. Add `-BrowserEvidence` to refresh the checked-in Chrome worker
measurement, or `-SkipBrowserSuites` for a native/protocol-only pass.

```powershell
./scripts/qualify-alpha.ps1
```

As of 2026-08-02, the M0-M3 part-design alpha implementation is complete under
automated coverage. This includes exact qualified features, dependency-driven
recompute, durable sketch hydration and support, worker-backed previews and
repair, OPFS recovery, content-addressed imported STEP sources, portable file
round trips, and File System Access with upload/download fallback. Private-alpha
exit still requires the representative-device 60 fps/performance run, an
independent STEP reader result, manual keyboard/screen-reader/accessibility
passes, and external user sessions recorded in
[manual alpha validation](docs/manual-alpha-validation.md).
