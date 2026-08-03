# Crawler Product Requirements

- Status: Draft 0.1
- Date: 2026-07-31
- Product: Crawler
- Kernel: `vendor/monstertruck`
- Surface: Installable browser application (WASM/PWA)

## 1. Product thesis

Crawler is a first-class mechanical CAD system that happens to run in the
browser. It should make a model's intent obvious: what operation is active,
what it consumes, what it produces, what depends on it, and why a recompute
failed.

The product combines four useful ideas without cloning any one application:

- Fusion's approachable feature timeline and direct manipulation.
- FreeCAD's inspectable object model and broad, open CAD ambitions.
- FreeCAD NUT's cleaner, preconfigured presentation of powerful tools.
- FluidCAD's readable parametric history and low-friction path between exact
  values and interactive edits.

The differentiator is not more commands. It is a clearer contract between
selection, operation, parameter, dependency, and result.

## 2. Problem

Parametric CAD tools commonly make users pay a “state tax”:

- The active workbench, command, selection filter, body, sketch plane, and
  rollback position may all be hidden in different parts of the interface.
- The model tree and feature timeline often present overlapping but different
  versions of the document.
- Direct manipulation may create opaque values instead of editable design
  intent.
- A topology change can silently invalidate downstream face and edge
  references, producing confusing failures far from the original edit.
- Long recomputes block exploration and make users afraid to edit earlier
  features.

Browser CAD adds its own risks: main-thread stalls, large WASM downloads,
memory pressure, file-system expectations, and weak crash recovery.

## 3. Product principles

1. **Operations explain themselves.** Every command exposes required inputs,
   optional inputs, parameters, preview state, and expected output.
2. **Direct edits remain parametric.** Dragging a manipulator edits a named
   value or constraint; it does not create an unexplained transform.
3. **History is a dependency graph with a readable timeline projection.** The
   timeline is not the undo stack.
4. **Failure is local and repairable.** The first broken feature is identified,
   downstream impact is visible, and missing references can be rebound.
5. **Selection is an explicit input.** Preselection, selected topology kind,
   scope, and filters are always legible.
6. **The viewport is the primary workspace.** Panels support the geometry
   instead of competing with it.
7. **Power is progressively disclosed.** Common operations are obvious;
   expressions, dependency inspection, and advanced options remain close at
   hand.
8. **Local-first is the default.** Modeling, save, undo, and recovery work
   without an account or network round trip.

## 4. Target users

### Primary

- Product designers and mechanical engineers creating individual parts and
  small assemblies.
- Makers and fabrication-oriented users who need dimensionally exact models
  and STEP/STL exchange without installing a heavyweight desktop suite.
- Experienced CAD users who want a faster, cleaner modeling environment.

### Secondary

- Tool builders who need inspectable, portable model history and deterministic
  interchange.
- Educators and students who benefit from a legible construction history.

### Not an initial target

- Enterprise PLM administrators.
- Large-team concurrent assembly design.
- Production CAM, BIM, or simulation workflows.

## 5. Core jobs to be done

1. Create a dimensionally exact part from sketches and features.
2. Understand an unfamiliar model by stepping through how it was built.
3. Change an early dimension and predict what will recompute.
4. Find and repair the first broken reference after a topology change.
5. Import a STEP model, modify or combine it, and export a valid result.
6. Move fluidly between viewport manipulation and exact parameters.
7. Save locally, close the browser, and resume without losing work.

## 6. Recommended workspace model

The recommended first direction is a **history-first spatial workspace**:

- **Top:** a compact command shelf grouped by Sketch, Create, Modify, Inspect,
  and Export. The shelf changes with context but never hides the active command.
- **Left:** a document browser for components, bodies, sketches, construction
  geometry, and visibility. This answers “what exists?”
- **Center:** the modeling viewport, selection feedback, manipulators, and
  in-canvas dimensions.
- **Right:** a single inspector that shows either the active operation, the
  selected object, or document parameters. This answers “what can I change?”
- **Bottom:** the feature timeline with rollback, recompute state, dependency
  cues, and a compact diagnostics drawer. This answers “how was it made?”

The browser and timeline must not duplicate each other. A body is an object in
the browser; Extrude 3 is a feature in the timeline that contributes to it.

### Portable history, not code-linked modeling

Code-linked authoring is explicitly not a product goal. Crawler will not expose
a synchronized script pane, generate user-editable modeling code, or treat
arbitrary code as the source of truth for a model.

Portability belongs in the native document family instead. Part, assembly, and
derived drawing files must use a versioned, documented representation that
retains the history required to inspect and recompute each artifact. The format
may encode operations declaratively, but that encoding is a durable data model,
not a general-purpose programming or user-facing scripting surface.

### Alternative direction B: visual-programming addon

A dependency canvas is a strong addon opportunity: an optional procedural
modeling environment related to Crawler in the way Grasshopper relates to
Rhino. Crawler remains the complete CAD application and its history-first
workspace remains the default authoring surface.

The addon would expose typed nodes for Crawler parameters, selections,
operations, parts, and assemblies through the same operation contracts used by
the core application. Its graphs would be stored as related, versioned documents
with explicit provenance for generated outputs. This is an extension boundary
to design for, not an alpha feature or a hidden second interface inside Crawler.

## 7. Operation lifecycle

Every modeling command follows the same visible state machine:

1. **Invoke.** The inspector names the operation and shows its output type.
2. **Collect inputs.** Required slots such as Profile, Axis, Target Body, and
   Direction are visible. Clicking a slot activates the correct selection
   filter.
3. **Preview.** A coarse, cancellable preview appears. Manipulators and numeric
   fields update the same parameters.
4. **Validate.** Invalid values and missing inputs are explained next to the
   relevant slot. The last valid preview may remain visible in a distinct style.
5. **Commit.** One atomic document command creates or edits one feature.
6. **Recompute.** Only the affected downstream graph is evaluated.
7. **Explain.** The new timeline item is selected and its dependencies can be
   highlighted on demand.

`Enter` commits, `Escape` cancels, and command search can invoke every operation.
These behaviors should be consistent across the application.

## 8. Timeline and history requirements

### Feature timeline

- Show features in a stable topological order with compact type icons and
  human-readable names.
- Display clean, dirty, computing, warning, failed, and suppressed states.
- Support edit, rename, suppress/unsuppress, delete, group, and roll back.
- Highlight upstream inputs and downstream consumers without forcing a graph
  view.
- Prevent invalid reordering and explain the dependency that blocks a move.
- Preserve a last-known-good result for downstream inspection when practical.
- Offer “recompute from here” and a compute-time diagnostic for slow features.

### Undo and redo

Undo/redo is a separate transactional command stack. It includes feature edits,
renames, visibility changes where appropriate, and parameter changes. Moving the
timeline rollback marker does not erase later features and is not undo.

### Branching

Full branching history is post-alpha. Alpha should allow duplicate document,
duplicate component, and named parameter sets so users can explore alternatives
without inventing a source-control UI.

## 9. Parametric model

### Document entities

- `Document`: schema version, units, parameters, components, feature graph,
  view state, and recovery metadata.
- `Component`: local coordinate system, child components, bodies, and joints
  when assemblies arrive.
- `Body`: one or more kernel solids plus appearance and visibility.
- `Sketch`: plane reference, geometry, constraints, dimensions, and solver
  state.
- `Feature`: stable ID, operation type, typed inputs, parameters, output IDs,
  dependencies, and recompute state.
- `Parameter`: stable ID, name, typed quantity, expression, unit, description,
  and dependency state.
- `TopologyReference`: owning feature/body, topology kind, stable kernel ID,
  and fallback geometric signature for diagnosis and repair.

### Parameter behavior

- All dimensional values are unit-aware quantities, not bare floats.
- Fields accept literals, named parameters, and expressions.
- The UI displays the evaluated value while preserving the entered expression.
- Dependency cycles are rejected with a readable cycle path.
- Renaming a parameter updates references structurally, not by string replace.
- Common values can be promoted to a named parameter from any operation field.
- Parameter sets/configurations are beta scope after the single-model graph is
  reliable.

### Portable document family

Crawler's native format is a family of portable, versioned documents:

- **Part documents** preserve parameters, sketches, feature dependencies,
  topology references, recompute state, and complete construction history.
- **Assembly documents** preserve component occurrences, transforms, joints,
  constraints, linked part identities and revisions, and assembly-level history.
- **Derived drawing documents** preserve sheets, views, annotations, dimensions,
  source-document references, derivation settings, and the provenance required
  to update the drawing from its source history.

The format must support deterministic validation and migration without executing
embedded user code. A portable file should remain understandable and recoverable
independently of Crawler's current interface implementation.

The document family must also be friendly to Git and other version-control
systems:

- Canonical serialization produces identical semantic content for identical
  document state; save order, timestamps, caches, and UI layout do not create
  model diffs.
- Stable entity IDs make parameter, feature, occurrence, and drawing changes
  addressable across revisions.
- A canonical, human-inspectable manifest carries document structure and
  history. Large binary payloads are separate, content-addressed artifacts so an
  unchanged mesh or imported source does not churn every revision.
- Structural diff tooling reports changes in model terms, such as a parameter
  edit, feature insertion, joint change, or drawing-view update.
- Merge tooling may combine provably independent semantic changes. Conflicting
  feature, topology, or provenance edits require explicit resolution and must
  never be silently guessed.
- Schema migrations are deterministic and record the source and destination
  format versions without erasing the original design history.

### Stable references and repair

Monstertruck already carries stable IDs on vertices, edges, and faces in its
Rust topology model. Crawler must expose those IDs through its kernel protocol
and persist them in feature inputs.

Stable IDs alone do not solve topological naming. When an input cannot be
resolved after recompute, Crawler should:

1. Stop at the first affected feature.
2. Show the missing input in its operation inspector.
3. Highlight likely replacement topology using type and geometric signatures.
4. Let the user rebind the reference explicitly.
5. Recompute downstream features and summarize what recovered.

No automatic match should silently change design intent.

## 10. Initial functional scope

### Alpha quality gate

The alpha is a coherent part-modeling vertical slice, not a gallery of isolated
kernel demos.

Required:

- New/open/save-as for a portable, versioned native part document.
- Autosave and crash recovery in browser storage.
- One document with components/bodies and visibility controls.
- Orthographic/perspective camera, standard views, fit, orbit, pan, and zoom.
- Hover preselection and click selection for body, face, edge, and vertex.
- Selection filters and multi-select.
- Sketch on origin plane or planar face.
- Sketch line, rectangle, circle, arc, trim, and construction geometry.
- Coincident, horizontal, vertical, parallel, perpendicular, tangent, equal,
  distance, radius, and angle constraints.
- Solver status: under-, fully-, over-, and conflicting-constrained.
- Extrude, revolve, boolean union/cut/intersect, fillet, chamfer, shell, pattern,
  mirror, and transform, gated by kernel readiness.
- Editable feature timeline, rollback, suppression, and deterministic recompute.
- Named unit-aware parameters and expressions.
- STEP import/export and STL/OBJ mesh export.
- Explicit failed-feature diagnostics and reference repair.
- Keyboard command search and consistent commit/cancel behavior.

### Beta

- Small assemblies, occurrences, joints, and interference inspection.
- Configurations/parameter sets.
- Section analysis and measurement tools.
- Portable assembly and derived drawing documents with retained history and
  source provenance.
- Shareable read-only documents without requiring collaboration to edit.
- Extensible command/operation schema.

### Later

- Drawings, GD&T, CAM, simulation, sheet metal, large assemblies, real-time
  collaboration, PLM integrations, third-party extensions, and the optional
  visual-programming addon.

## 11. Explicit non-goals for alpha

- Matching the full command breadth of FreeCAD or Fusion.
- Arbitrary direct B-rep editing without captured design intent.
- Code-linked modeling, generated modeling code, synchronized script authoring,
  or arbitrary code round-tripping.
- Multi-user editing.
- Cloud-required storage or compute.
- Mobile authoring. Tablet viewing may work, but desktop pointer/keyboard input
  is the design target.
- Pixel-for-pixel imitation of any reference application.

## 12. Monstertruck kernel fit

The pinned Phase 5 kernel commit currently provides:

- B-rep topology and modeling primitives.
- Vertex, line, arc, Bezier, transform, extrude, revolve, and primitive builders.
- Boolean operations.
- Fillet support in the Rust modeling stack.
- Tessellation and polygon buffers.
- STEP read/write and STL/OBJ mesh I/O.
- Stable topology IDs and serialization support in Rust.
- `wgpu`-based rendering crates with WASM-aware code paths.

The current `monstertruck-wasm` surface exposes a smaller subset: primitive
construction, transforms, extrude/revolve, booleans, tessellation buffers,
STEP, STL/OBJ, and JSON shape serialization. It does not yet expose a Crawler
document graph, sketch constraints, stable topology references, provenance-rich
pick buffers, complete solid operations, or structured errors.

Crawler currently pins commit `e9024ba7` from the Phase 5 upstream-readiness
branch. The default `master` commit (`45e5f8d6`) does not compile the WASM target
because its `getrandom` dependency is not configured for that target; the Phase
5 line contains the repair as well as continuity and topology-tracking work.
Crawler should continue to pin reviewed commits rather than implicitly following
a branch.

## 13. Proposed technical architecture

```text
UI shell and editor state (main thread)
        |
        | typed commands / events
        v
Parametric document engine (Rust/WASM worker)
        |
        | dependency evaluation
        v
Monstertruck kernel (Rust)
        |
        | transferable render packets + topology provenance
        v
Viewport renderer and picking (WebGPU, WebGL2 fallback)
```

### Boundaries

- The **UI shell** owns panels, shortcuts, transient command state, layout, and
  accessibility.
- The **document engine** owns the durable model, units, expressions, feature
  graph, transactions, recompute scheduling, and native-file schema.
- **Monstertruck** owns geometric/topological computation and interchange.
- The **renderer** owns camera, draw state, highlighting, overlays, and GPU
  picking, but not authoritative geometry.

The document engine belongs in Rust beside the kernel and runs in a dedicated
worker. Keeping the feature graph in TypeScript would make persistence,
deterministic recompute, and future non-browser reuse harder. The UI should talk
to it through a versioned command/event protocol rather than holding raw WASM
shape handles.

### Operation schema

Each operation should publish a typed schema containing:

- Operation ID, label, group, and output kind.
- Input slots and allowed topology/object kinds.
- Parameters, types, units, bounds, defaults, and advanced grouping.
- Preview strategy and cancellation behavior.
- Validation errors and repair actions.

The schema drives the inspector, command search, keyboard flow, persistence,
and portable document validation. This prevents five separate implementations
of the same operation contract.

### Rendering decision to spike

Two approaches are credible:

1. Integrate `monstertruck-render`/`wgpu` into the application canvas.
2. Transfer provenance-rich mesh buffers to a web renderer and keep the kernel
   isolated in a worker.

The spike must compare build size, interaction with the worker boundary,
face/edge picking, highlight latency, WebGL2 fallback, and buffer-copy cost.
Do not lock the application framework before this spike.

### Browser persistence

- Native part, assembly, and derived drawing documents: portable, versioned
  structured data stored in the Origin Private File System when available.
- Version-control export: canonical manifest plus content-addressed payloads,
  without transient caches or view state in the semantic diff.
- User-selected files: File System Access API with download/upload fallback.
- Recovery: journal accepted document commands and checkpoint periodically.
- Export: never mutate the document merely to create STEP/STL/OBJ output.

## 14. Performance and reliability budgets

These are initial product budgets and should become measured test fixtures:

- UI feedback for pointer/field input: within 50 ms.
- Orbit/pan/zoom: 60 fps on a representative mid-range desktop.
- Coarse preview for a simple feature: visible within 100 ms.
- Commit/recompute for the reference part: under 500 ms at p50 and under 2 s at
  p95.
- No kernel operation may block the UI main thread.
- Cold application load on broadband: interactive within 5 s; show useful load
  progress for the WASM payload.
- Autosave must never pause interaction for more than one frame.
- A kernel panic or worker crash must preserve the last durable checkpoint and
  offer recovery on reload.

Monstertruck disables Rayon on WASM today, so alpha should assume single-threaded
kernel evaluation inside the worker. Use dirty-graph recompute, cancellation,
coarse previews, and caching before depending on WASM threads and cross-origin
isolation.

## 15. Accessibility and input

- Full keyboard access to command search, operation forms, timeline traversal,
  browser tree, commit, and cancel.
- Visible focus and non-color state indicators.
- Do not require hover to discover a command or failure.
- Support mouse and trackpad navigation presets, with one documented default.
- Provide reduced-motion behavior for camera transitions and timeline changes.
- Keep touch targets reasonable even though desktop authoring is primary.

## 16. Success measures

### Usability

- A CAD-experienced user can create the reference part without documentation.
- A new CAD user can identify the active operation and its missing input within
  five seconds.
- Users can locate and edit a driving dimension in an unfamiliar reference
  model within 30 seconds.
- After an intentionally broken face reference, most test users can identify
  the first failed feature and repair it without opening logs.

### Technical

- Deterministic document output for identical command streams.
- Round-trip portable documents without history, provenance, or
  topology-reference loss.
- Re-saving an unchanged semantic document produces no version-control diff.
- Structural diff fixtures identify parameter, feature, assembly, and derived
  drawing changes by stable identity.
- Merge tooling rejects conflicting semantic edits instead of silently choosing
  geometry or history.
- STEP import/export reference corpus passes visual and geometric validation.
- Undo/redo restores document hashes across the reference command corpus.
- No main-thread long task over 100 ms during the reference modeling workflow.

## 17. Risks and mitigations

| Risk | Product impact | Initial mitigation |
| --- | --- | --- |
| Topological naming is incomplete | Early edits break later features | Persist stable IDs plus signatures; make repair a first-class flow; build mutation tests early |
| WASM API returns opaque `Option` failures | Users cannot understand errors | Add structured kernel error/result types before broad operation work |
| Sketch solver scope balloons | Core workflow slips | Define a small, deterministic 2D constraint set and a reference corpus |
| Main-thread or memory pressure | Browser feels less capable than desktop CAD | Worker isolation, transfer buffers, incremental tessellation, explicit memory telemetry |
| Rendering path and kernel diverge | Picking and highlights select the wrong topology | Include topology provenance in every render packet and regression-test GPU picking |
| Feature breadth outruns reliability | Demo looks broad but cannot survive edits | Gate each feature on edit, recompute, undo, save/load, and failure tests |
| Kernel branch drift | UI depends on unreviewed behavior | Pin exact submodule commits and maintain an integration contract suite |

## 18. Proposed milestones

### M0 — architecture spikes

- Record the Monstertruck baseline and establish its integration contract suite.
- Prove worker-hosted WASM command round trips and cancellation.
- Compare the two renderer integration paths with face/edge picking.
- Define the portable document family, feature, parameter, provenance,
  topology-reference, canonical serialization, and diff/merge contracts.
- Define the operation schema and structured error contract.

Exit: one ADR-backed architecture and measured spike results.

### M1 — parametric cube vertical slice

- Document creation, autosave, and recovery.
- Origin planes, a constrained rectangle sketch, and extrusion.
- Viewport selection, operation inspector, browser, and timeline.
- Edit the rectangle dimensions or extrusion distance and recompute.
- Transactional undo/redo and native save/load.

Exit: the same model survives edit, undo, reload, and export.

### M2 — useful part modeling

- Additional sketch tools and constraints.
- Revolve, booleans, fillet/chamfer, shell, mirror, and pattern as kernel support
  is validated.
- STEP import/export and mesh export.
- Named parameters and expressions.
- Suppression, rollback, dependency cues, and reference repair.

Exit: complete a public mechanical reference part and pass the reliability and
performance budgets.

### M3 — private alpha

- Workflow polish, keyboard system, accessibility pass, diagnostics, recovery,
  and onboarding.
- Reference corpus and compatibility/version migration tests.
- Installable PWA packaging and offline behavior.

Exit: external users can model and recover from errors without developer help.

## 19. Decisions needed before implementation

1. Is the first release deliberately **part design only**, or must small
   assemblies shape the document model from day one?
2. Does one portable package contain related part, assembly, and derived drawing
   documents, or does each artifact remain a separately addressable file?
3. What validation and promotion policy advances the pinned Monstertruck
   baseline?
4. Does the first renderer spike favor in-WASM `wgpu` integration or
   transferable render packets?
5. Which portable document encoding, canonical manifest, payload layout,
   schema-migration policy, and semantic diff/merge contract will be supported?
6. Which reference part and STEP corpus define “first-class” alpha quality?
7. Which mouse navigation convention is the default, and which presets are
   required for users coming from Fusion, FreeCAD, and Blender?

## 20. Recommended first decision

Commit to a **part-design alpha with the history-first spatial workspace** and
make the parametric cube vertical slice the first executable spec. Keep the
document schema ready for components, but do not build assembly behavior until
feature recompute, persistence, and stable-reference repair are trustworthy.

## 21. Reference notes

Research checked on 2026-07-31:

- [FluidCAD](https://fluidcad.io/) — interactive viewport prototyping, feature
  history, and STEP interop; its code-first authoring model is intentionally not
  part of Crawler's direction.
- [FreeCAD NUT](https://freecadnut.com/) — a cleaner, preconfigured presentation
  of FreeCAD's broad toolset and construction history.
- [FreeCAD downloads](https://www.freecad.org/downloads.php) — FreeCAD 1.1.3 was
  the current stable release when this draft was written.
- [Fusion modeling modes](https://help.autodesk.com/view/fusion360/ENU/?contextId=ASM-DESIGN-MODELING-MODES)
  — parametric features tracked in the timeline alongside direct modeling modes.
- [`KTheMan/monstertruck`](https://github.com/KTheMan/monstertruck) — pinned in
  this repository as the geometry kernel submodule.
