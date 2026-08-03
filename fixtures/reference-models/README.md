# Crawler reference models

This directory is executable evidence for story E00-S06. `catalog.json` is the
only fixture discovery mechanism; validators do not infer fixtures or assets
from directory contents.

All material in this directory was authored or deterministically generated for
Crawler and is dedicated under `CC0-1.0`. No third-party model provenance is
claimed. Each `fixture.json` records its exact creator, source method,
generator, license scope, document byte length/SHA-256, topology assertions,
and geometric evidence. STEP artifacts also record their own lengths and
hashes.

Run the executable validator through the `crawler-reference-fixtures` crate.
The fixture records are deliberately data-only and contain no scripts,
timestamps, machine paths, view state, caches, or recovery state.

## Mechanical alpha qualification

`cc0-mounting-bracket` is the public mechanical reference part. The
`crawler-alpha-reference` qualification reads its recorded document SHA-256,
revision, topology assertions, geometric bounds, license, and provenance. It
then executes deterministic revolve, boolean-union, and linear-pattern kernel
operations from the bracket's driving dimensions and records their topology,
bounds, volume bits, and geometry digests. The same run verifies exact
save/load equality for the bracket document, an atomic parameter-edit
undo/redo hash cycle, and deterministic STEP/STL/OBJ exports of the advanced
body.

The native qualification also emits the complete metadata envelope required by
the reference measurement protocol. Browser, device class, build/source
revision, warm/cold state, raw observations, and percentiles remain absent
until a real measured run supplies them; no estimated timings are substituted.
Independent-reader STEP evidence is likewise recorded as pending until an
identified external reader and version complete both geometric and visual
validation. The in-process STEP inspection is round-trip evidence, not an
independent-reader claim.

The inspectable B-rep cube is regenerated deterministically with:

```powershell
cargo run -p crawler-interchange --example export_reference_cube -- fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step
```

The two compact CSG samples remain compatibility fixtures: the alpha importer
retains and diagnoses them as unsupported geometry rather than discarding the
source bytes.
