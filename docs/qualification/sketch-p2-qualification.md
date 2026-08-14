# Sketch P2 qualification

P2 is qualified as the complete remaining-creation, retained-text, and native-curve interchange slice.

## Acceptance mapping

- **Creation methods:** rectangle supports two-point, three-point, and center methods; circle supports center-diameter, two-point, three-point, two-tangent, and three-tangent methods; arc supports center-point, three-point, and tangent methods; polygon supports inscribed, circumscribed, and edge methods; slot supports center-to-center, overall, center-point, and three-point-arc methods. Method-specific panels retain polygon and slot intent while every result remains native sketch geometry. Tangent circles, tangent arcs, and text-on-path accept compatible operands both before and after tool activation, with explicit operand progress and highlighting.
- **Sketch text:** straight and path-following engineering-stroke text is retained as editable recipe intent with height, rotation, tracking, alignment, path position, and reversal. Source-path edits recompute linked text; explode removes only the recipe and preserves its native curves.
- **SVG/DXF interchange:** SVG imports and exports standard line, circle, ellipse, rectangle, polyline, polygon, cubic, quadratic, and elliptical-arc constructs as native sketch entities; canonical metadata supplements those standard curve commands for exact Crawler identity round trips. DXF imports and exports native points, lines, circles, arcs, ellipses/elliptical arcs, control splines, standard fit-point SPLINE records, and rational conics with standard weight groups. Metadata-stripped SVG and DXF exports are re-imported as native curves in qualification tests rather than sampled line entities.
- **Persistence and lifecycle:** canonical recipe metadata survives solve, document commit, reload, later edit, and explode. The browser workflow exercises every creation family, text-on-path editing and explode, SVG/DXF download, and SVG/DXF import through the shipped WASM runtime.

## Reproducible gate

Run `powershell -ExecutionPolicy Bypass -File scripts/qualify-sketch-p2.ps1` from the repository root. The gate runs the complete sketch Rust suite and P2 runtime persistence test, regenerates release WASM, runs all browser unit tests and the production build, then runs the P2 creation/text/interchange workflow together with the complete sketch lifecycle and shipped-WASM browser suites.
