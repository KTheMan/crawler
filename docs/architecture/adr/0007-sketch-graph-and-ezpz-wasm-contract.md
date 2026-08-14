# ADR 0007: Sketch graph decomposition and EZPZ WASM contract

- Status: Accepted
- Date: 2026-08-03
- Story: E04-S01 through E04-S05

## Context

Crawler's first sketch implementation combined a durable, integer-nanometer
document DTO with a local projection solver. The DTO, stable IDs, atomic
transaction behavior, profile reporting, and browser worker boundary are useful
application contracts. The projection engine is not the long-term numerical
foundation for general 2D constraint systems.

[KittyCAD EZPZ](https://github.com/KittyCAD/ezpz) is a Rust geometric constraint
solver that compiles for native and WebAssembly targets. Its public Rust API
accepts variable IDs, initial guesses, and typed constraints, then returns
solved values and freedom analysis. Its own sample WASM crate recommends
integrating the core library directly rather than adopting the sample bindings
as an application protocol.

[PlaneGCS](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/Sketcher/App/planegcs/GCS.cpp)
separates graph preparation from numerical solving. In particular, it constructs
a bipartite graph between parameters and constraints, identifies connected
components, and solves decoupled subsystems independently. Crawler needs that
architectural separation while retaining its Rust/WASM and licensing
requirements; it does not incorporate PlaneGCS source.

## Decision

The Crawler 2D pipeline is:

1. Validate and canonicalize the Crawler-owned `Sketch` DTO.
2. Produce a deterministic integer-grid propagation seed. This selects the
   existing solution branch and prevents floating-point solutions from
   needlessly moving already accepted geometry; it is not independently
   committable.
3. Build a deterministic bipartite graph whose partitions are durable geometry
   entities and driving constraints and whose edges are constraint references.
4. Find connected components in stable ID order, expand each component into
   conservative scalar-variable/equation rows, and compute a deterministic
   maximum matching for structural rank, structural degrees of freedom, and
   potentially redundant equations. Isolated geometry remains a
   valid component so it passes through the same merge path.
5. Translate each component into EZPZ variables and constraints. EZPZ IDs are
   ephemeral adapter details and never enter documents, operation logs, or UI
   messages.
6. Solve each component with EZPZ, merge by durable geometry ID, round back to
   the integer-nanometer grid, and verify every Crawler constraint before a
   result may be committed.
7. For drag, add temporary fixed equations to the driven point's component,
   solve, then solve again without the temporary equations before acceptance.
8. Reject the entire sketch transaction if any component fails or conflicts.

The component graph is deliberately conservative at geometry-entity
granularity. Its structural pass expands each geometry into scalar DOF slots,
but connects an equation to every slot of each referenced geometry. This can
understate separability within one entity, but cannot incorrectly split a
coupled solve. EZPZ freedom analysis remains distinct from the structural
matching result because it reports variables participating in free motion, not
the null-space rank.

`crawler-sketch` owns the decomposition and EZPZ adapter. EZPZ is pinned to
`0.2.28` in the workspace lockfile. `crawler-part-runtime` remains the ultimate
WASM application contract holder and exposes JSON-only single and batched
sketch commands, drag, decomposition, solve/commit, deterministic DXF
import/export, and solver-contract metadata. Browser code does not import raw
EZPZ or numeric matrix types.

Sketch geometry remains plane-local throughout this pipeline. A durable sketch
stores one support reference (`origin_plane`, `origin_plane_reference`,
`topology`, or `construction_plane_reference`). The document/kernel/renderer
side resolves that reference to a right-handed frame containing
`origin_nanometers`, `x_axis_millionths`, `y_axis_millionths`, and
`normal_millionths`. Camera-ray intersection converts model-space input into
integer plane-local nanometers before a command crosses the worker boundary;
solved geometry is transformed back through the same frame for 3D rendering.
Neither the graph frontend nor EZPZ receives model-space XYZ values.

XY, XZ, and YZ are resolved from addressable origin-plane definitions. A body
face is admitted only when its stable topology reference supplies centroid and
normal evidence and the current render mesh independently proves coplanarity;
missing identity requires explicit rebind. Construction-plane references are
part of the support contract now, while their offset/angled/tangent definition
resolver remains a document/kernel extension point.

The contract metadata is versioned independently from document schema and
currently reports:

- schema version `2`;
- frontend `planegcs_inspired_graph_decomposition`;
- backend `kittycad_ezpz` version `0.2.28`;
- durable numeric units `integer_nanometers`.
- coordinate space `resolved_plane_local_2d`, four durable support-reference
  kinds, and the four resolved-frame fields above.

## Consequences

- Native tests and browser WASM execute the same EZPZ backend through the same
  Crawler adapter.
- Disconnected sketch regions no longer need to share one nonlinear system.
- Stable IDs, canonical serialization, document transactions, undo, and worker
  messages remain Crawler-owned and backend-independent.
- EZPZ upgrades require an explicit version change plus native, WASM-target,
  decomposition, constraint-corpus, and atomic-commit qualification.
- Graph decomposition supplies subsystem boundaries, not a claim that
  structural matching is the numerical Jacobian rank. Numeric freedom and
  residual conflict diagnostics remain EZPZ-owned and can evolve behind the
  versioned result contract.
- Static DXF input and canonical output fixtures provide a viewer-independent
  sanity workload while preserving durable IDs through `CRAWLER` XDATA.
- Plane-local DXF output is invariant across XY/XZ/YZ support choices; placement
  in model space is intentionally represented by the sketch support/frame, not
  by rewriting 2D entity coordinates.
