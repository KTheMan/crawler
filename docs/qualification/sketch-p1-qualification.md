# Sketch P1 qualification

P1 is qualified as one retained-operation and contextual-diagnostics vertical slice.

## Acceptance mapping

- **Associative modification:** canonical `SketchOperation` records retain source/result identities and editable parameters for offset, mirror, linear/circular patterns, fillet, three chamfer modes, break, scale, move/copy, and tangent/G2 blend. Canonical command recomputation runs after source or operation edits; unlink leaves independently editable results.
- **Project/Include:** retained records cover point, edge, face, body, work-geometry, sketch, and plane-intersection source kinds. The viewport projects vertices, edges, planar-face boundaries, and body edges; external references retain body/kernel identity, lock and link state, missing-source diagnostics, rebind, and unlink behavior.
- **Palette and diagnostics:** the contextual palette exposes Look At, Slice, grid, snap, and six visibility layers. Canvas entities expose solve state, remaining DOF, participation, conflicts, profile diagnostics, and orphaned references. Pattern suppression hides the selected instances and retained pattern handles expose direction/extent or center/angle.

## Reproducible gate

Run `powershell -ExecutionPolicy Bypass -File scripts/qualify-sketch-p1.ps1` from the repository root. The gate runs the complete sketch Rust suite, retained-operation runtime persistence/reload test, regenerates the release WASM, runs all browser unit tests and the production build, then runs the complete sketch lifecycle and shipped-WASM browser suites.
