# UI element audit — 2026-08-18

## Scope and evidence

The audit covers every rendered control family in `web/crawler-app`: application menus, quick file actions, workbenches/ribbons/flyouts, browser tree, viewport and view cube, selection filters, inspector tabs and dynamic operation forms, context menus, timeline, parameters, command search, onboarding, error/recovery surfaces, themes, and active-sketch tools.

Evidence combined a source-to-handler inventory, rendered inspection in the in-app browser at `http://127.0.0.1:4174/` (1440×900), actual button presses with their resulting state/artifacts, the existing unit/end-to-end suites, and focused regression tests added in `tests/ui-element-audit.spec.ts`.

- Unit baseline after prioritized fixes: **209 passed, 0 failed**.
- Stable focused UI verification after fixes: **15 passed, 0 failed** (6 UI-audit, 5 portable/solid interchange, 1 sketch interchange, 3 command-surface tests).
- Prioritized follow-up verification: **8 passed, 0 failed** (3 dimension/Extrude lifecycle, 3 accessibility/body/readiness, 1 Boolean ribbon/recovery, 1 view-cube Timer). Five related legacy UI regressions also pass after updating stale hidden-field/future-control expectations.
- Second prioritized follow-up verification: **19 passed, 0 failed** (advanced-feature keyboard lifecycle, Sketch command discovery, timeline/viewport context actions, blank and populated exports, STEP outcomes, and native picker routing). The two existing exact-Line command-search regressions also pass.
- The broad pre-fix Playwright baseline was stopped after concurrent test changes invalidated the run. Before stop, 59 unique tests completed: **44 passed, 15 failed**. The actionable clusters are cataloged below.

## What works

| Surface | Working controls/behavior | Evidence |
|---|---|---|
| File/document | New, Open `.crawlerpart`, Save, Save As, Save Copy, autosave, native picker and download fallbacks | Existing portable tests plus Save Copy association regression |
| Solid interchange | STEP/STP B-rep and CSG `BLOCK` import with progress/cancel/re-import; STEP, STL and OBJ download | Focused existing tests plus visible File → Import STEP CSG outcome regression |
| Sketch interchange | SVG and DXF import/export from an active sketch; top-level File/Insert/Export discovery now routes to the same working controls | Existing sketch interchange test plus menu regression |
| Theme interchange | `.fctheme` and legacy `.zip` import, persistence, removal and GitHub source UI | Existing theme tests/source handler audit |
| Menus | File, Edit Undo/Redo, View/panel/full-screen commands, implemented Sketch commands, implemented Model commands, Tools, Insert, Export and Help actions | Source-to-handler inventory and command-surface tests |
| Workbenches/ribbon | Part Design and Sketcher switching; pinned tools; flyouts; customization; restore defaults; drag order persistence | Existing command/ribbon tests and rendered inspection |
| Browser tree | Component/body/sketch/origin selection; group expand/collapse; body and sketch visibility | Source-to-handler inventory and existing app tests |
| Viewport | Selection filters, standard views, fit, grid, projection, background presets/custom color, display modes, view cube/navigation | Existing viewport tests; focused custom-background regression |
| Inspector | Properties/Constraints/Appearance tabs; advanced feature forms; sketch tool panels; feature rename/suppress/delete when supported | Existing feature/sketch tests and handler inventory |
| Timeline | Feature selection, playhead, start/back/forward/end, rollback services; feature context menu now opens from timeline items | Existing history tests plus focused context-menu regression |
| Dialogs/overlays | Command search, Parameters dialog, onboarding, toolbar customization, context filtering, safe-mode recovery and action-error dismissal | Existing accessibility/onboarding/command tests and source inventory |
| Sketch tools | Draw, edit, construction, selection, geometric constraints, Smart Dimension, native curve handles, retained operations and constraint manager | Tool-manifest inventory and the large sketch unit/e2e matrix |

## Fixed in this pass

1. **Save Copy semantics** — now writes a separate `.crawlerpart` without replacing the handle used by subsequent Save.
2. **Supported format discovery** — File/Insert/Export menus now expose STEP/STP, STL, OBJ, SVG and DXF in the contexts where the backend supports them. Sketch-only commands explain that an active sketch is required instead of silently doing nothing.
3. **Misclassified implemented commands** — Polygon, Spline, both workbenches, Boolean Union/Subtract/Intersect and viewport Extrude Cut are no longer hidden as future capabilities.
4. **Context-menu no-ops** — timeline feature rows can open the feature menu; unavailable feature actions are disabled with a reason; blank/invalid viewport Extrude and visibility actions are disabled.
5. **Viewport custom background** — validates while editing and commits on change/blur as well as Enter; invalid input remains open and is marked invalid.
6. **Interchange correctness** — the document label uses `.crawlerpart` instead of unsupported `.fcstd`; OBJ downloads use `model/obj`; sketch file reads are caught/reset and unknown extensions are rejected; export requests now report runtime/read-only unavailability.
7. **Icon and renderer console noise** — all Lucide fallbacks used by the current ribbon are registered. The viewport-gizmo dependency is locally patched to use Three.js `Timer` (`reset` plus per-frame `update`) instead of deprecated `Clock`; view-cube animation remains outcome-tested.
8. **Actual STEP button outcome** — the visible File → Import STEP flow now materializes the checked-in CSG `BLOCK` cube instead of ending as `Operation: cancelled`. Import errors are reported as **failed**, while only an explicit Cancel action is reported as cancelled.

## Outcome-driven STEP reproduction and result

The original happy-path coverage used only `cube-brep.step` and often assigned the hidden file input directly. Pressing the visible File → Import STEP command uncovered a representation-specific gap:

| Fixture / action | Before | After |
|---|---|---|
| `cube-brep.step` | Committed, 1 body | Committed, 1 body |
| `cube-import.step` (`CSG_SOLID` → `BLOCK`) | `Operation: cancelled`, 0 bodies | `Operation: STEP import committed`, 1 body, bounds 0–10 mm |
| Invalid STEP through visible command | Misreported as cancelled | `Operation: STEP import failed` plus actionable error surface |
| Explicit Cancel import | Cancelled, source retained | Unchanged; still correctly reported as cancelled |

The automated regression opens the File menu, presses its visible Import STEP menu item, handles the resulting file chooser, and verifies committed state, feature creation, durable checksum mutation, and geometry bounds. A second regression verifies that a parse failure cannot display the word “cancelled.”

## Prioritized follow-up — implemented and outcome-tested

| Priority | Previous failure | Implemented result |
|---|---|---|
| P0 | Active modeling dimensions were hidden | Rectangle width/height and Extrude distance now appear in a labelled active-operation group, receive focus, and hide again after accept/cancel. |
| P0 | Enter after starting Extrude could leave `preview` active | Extrude synchronously focuses its distance field; Enter commits the edited value, while Escape restores the accepted value and checksum. |
| P1 | Boolean Union appeared to open inconsistently | The operation was already executable; the actual defect was two visible controls named **Combine**. The operation remains uniquely named **Combine**, the disclosure is now **More Combine operations**, and one-body input keeps the form visible with a specific tool-body recovery message. Existing two-body browser coverage verifies preview and commit. |
| P1 | The Parameters shortcut collided with the inspector disclosure's accessible name | The shortcut remains **Parameters**; disclosure names now state their action, for example **Collapse Parameters section** and **Expand Parameters section**. |
| P1 | Body Rename and Dependencies appeared as unavailable future actions | Rename now edits inline and commits `rename_entity` for the durable body. Dependencies selects the body's producer and opens its existing dependency/compute services. Delete is absent because the document contract has no atomic body deletion operation. |
| P2 | Runtime-dependent commands could enable during startup/recovery | Base modeling controls, Part catalog/ribbon buttons, STEP import, save commands, and command-search results now derive availability from document, worker, WASM, renderer, and safe-mode readiness. Recovery reverses those states. |
| P2 | The view cube constructed deprecated `THREE.Clock` | A reproducible package patch migrates `three-viewport-gizmo@2.2.0` to `THREE.Timer`, including `reset()` and per-frame `update()`. Browser coverage verifies animation and the absence of the Clock warning. |

## Second prioritized follow-up — implemented and outcome-tested

| Priority | Previous failure | Implemented result |
|---|---|---|
| P0 | Pressing Enter in an advanced-feature parameter field did not Apply because the global handler returned early for focused form controls | Valid Enter now uses the same preview validation and Apply path as the visible button. Invalid Enter marks and announces the field without mutation; Escape restores the accepted packet and dimensions. |
| P0 | Exporting STEP/STL/OBJ from a blank document could send an invalid request, report cancellation, and fault the runtime | Solid export controls now require an exportable body. The worker also returns a recoverable export error rather than a fatal runtime error, so failure cannot enter safe mode or masquerade as cancellation. Populated exports remain downloadable and read-only. |
| P0 | Feature context menus exposed Move Up but pruned Move Down despite an existing reorder transaction | Move Down computes the next insertion anchor and submits the existing atomic reorder transaction. Last-item state is disabled; dependency-invalid moves remain unchanged and show the document service's blocking feature. |
| P1 | Implemented Sketch constraints and Smart Dimension were missing from the Sketch menu and command search | The Sketch menu exposes the existing constraint and dimension handlers. Command search now includes non-catalog Sketcher tools, constraints, Select, and Smart Dimension with live contextual disabled reasons; exact command labels outrank related names. |
| P1 | Viewport Edit Feature was pruned even for bodies produced by editable advanced features | The viewport menu now resolves the accepted/selected advanced producer, enables Edit Feature only when durable edit data exists, and opens the same parameter editor used by the timeline and tree. |
| P1 | `Ctrl+O` bypassed the native portable-file picker used by the visible Open command | The shortcut now invokes the shared `openPortablePart()` path, including native picker support and the existing fallback. |

Two pre-fix onboarding failures expected a 3-step tour while the product intentionally renders 6 steps; those assertions are stale rather than a product defect.

## Intentionally unavailable (not broken)

- Production removes controls explicitly marked future (Assembly, Drawing, Mesh, clipboard/edit commands, measurements and other unfinished capabilities).
- Appearance shows material, line width, point size, line color and placement as unavailable readouts, not interactive controls.
- Body Delete remains absent: the document protocol can delete a feature but explicitly refuses deleting a feature while it owns a body, and it has no `DeleteBody` transaction. Rename and Dependencies are available.
- STL and OBJ are export-only. There is no import parser or worker request.
- IGES/IGS, 3MF, glTF/GLB, PLY and native FreeCAD `.fcstd` are not supported by the current backend.
- `.crawlerasm` and `.crawlerdraw` package kinds are specified but rejected by the current Part runtime because Assembly/Drawing runtimes are not implemented.

## Supported file catalog and boundaries

| Format | Import | Export | Current boundary |
|---|---:|---:|---|
| `.crawlerpart` | Yes | Yes | Canonical portable Part package |
| `.step`, `.stp` | Yes | Yes | B-rep shells and one standalone millimetre `CSG_SOLID` rectangular `BLOCK`; no assembly/history/color/PMI reconstruction, multiple CSG solids, conversion-based/non-mm CSG units, or other CSG primitives yet |
| `.stl` | No | Yes | ASCII mesh export |
| `.obj` | No | Yes | Geometry-only mesh; no MTL/UV/material contract |
| `.svg` | Active sketch | Active sketch | Line/circle/ellipse/rect/polyline/polygon/path geometry; no general CSS/group transform/viewBox pipeline |
| `.dxf` | Active sketch | Active sketch | LINE/CIRCLE/ARC/ELLIPSE/SPLINE/POINT; unsupported entities are ignored |
| `.fctheme`, `.zip` | Theme import | No | Appearance theme packs only |
