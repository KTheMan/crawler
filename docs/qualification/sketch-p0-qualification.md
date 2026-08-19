# Sketch P0 Qualification

- Roadmap scope: sections 3.1–3.4 of `fusion-class-2d-sketch-roadmap.md`
- Candidate date: 2026-08-09
- Product surface: public sketch workspace, worker/WASM runtime, canonical document model

## Acceptance matrix

| Acceptance area | Delivered evidence | Automated qualification |
|---|---|---|
| Native geometry | Sketch point, native degree/knotted control-point B-splines, fit-point splines, principal-axis ellipses, elliptical arcs, and conics remain native from creation through reload and plane-correct 3D display. | `remaining_native_geometry_round_trips_solves_and_preserves_subentity_identity`; `native_control_point_spline_round_trips_moves_and_participates_in_profiles`; `native_spline_commit_and_reload_preserve_control_point_identity`; `sketch-ux-lifecycle.spec.ts` |
| Stable sub-entities | End, center, control, fit, real B-spline knot, and millionth curve-parameter anchors are canonical and solver-addressable. | `spline_control_points_are_solver_addressable`; `open_uniform_b_spline_knots_split_natively_and_offset_intent_recomputes`; `universal_dimensions_and_curve_parameter_references_solve_durably`; `sketch-workspace.test.ts` |
| Curve services | Position/tangent/curvature frames, globally bounded adaptive projection/intersections, conservative bounds, exact native split, trim, offset, hit testing, and deterministic tessellation cover every native curve family. Adaptive offset pieces explicitly distinguish analytic certification from an observed validation residual; no sampled residual is labeled as a proof. Fit-spline intervals convert exactly to editable cubic B-spline pieces rather than being refit from probes. | `native_curve_service_supports_frames_projection_bounds_and_intersections`; `adaptive_curve_services_bound_narrow_knots_and_split_fit_splines_exactly`; `sketch-spline.test.ts`; `sketch-trim.test.ts`; `sketch-operations.test.ts` |
| Complete constraints | Collinear, symmetry, true endpoint curvature equality, point-pair H/V, geometry fix/unfix, point-on-curve, equal, and generalized tangency are durable solver constraints. Tangency covers internal circles plus bounded arcs and general native pairs while explicitly rejecting the invalid line-line case. | `complete_geometric_constraints_project_points_symmetry_and_object_fix`; `curvature_continuity_matches_endpoint_tangent_and_curvature`; `tangency_covers_internal_round_and_general_native_curve_pairs`; `line_line_tangent_is_rejected_and_composite_intent_is_canonical`; `point_on_native_curve_is_projected_and_solved` |
| Conflict behavior | Invalid application is atomic; conflict prediction reduces reports to an actionable minimal set while preserving unrelated intent. | `contradictory_solve_and_drag_are_atomic_and_report_minimal_constraint_ids`; `residual_conflict_reduction_removes_unrelated_constraints` |
| Universal Smart Dimension | Selection dispatch covers aligned/H/V point distance, line length, point-line and parallel-line/retained-offset distance, angle, radius/diameter, ellipse axes, centers, and arbitrary stable curve-parameter tangent points. The retained identity supports driving/reference mode, parameters, expressions, placement, canvas editing, and reload. | `universal_dimensions_and_curve_parameter_references_solve_durably`; `p0_constraints_and_dimension_parameters_reload_and_edit_durably`; `sketch-editor.test.ts`; `sketch-tool-manifest.test.ts`; Smart Dimension cases in `sketch-ux-lifecycle.spec.ts` |
| Composite intent | Polygon and slot entities retain canonical recipe IDs, member IDs, and editable construction parameters in addition to their explicit solver constraints. Polygon side-count edits preserve unaffected members and atomically create/remove topology plus generated intent. Primitive and native-curve offsets retain one durable `offset_distance` relation per result segment. | `line_line_tangent_is_rejected_and_composite_intent_is_canonical`; `polygon_recipe_side_count_edits_retain_unaffected_members_and_rebuild_intent`; `durable composite recipes hydrate with editable parameters and stable members`; `advanced profile generators emit stable connected solver geometry`; `open_uniform_b_spline_knots_split_natively_and_offset_intent_recomputes`; `native curve offsets retain editable connected native segments` |
| Automatic inference | Origin, coincident, H/V, parallel, perpendicular, tangent, midpoint, center, collinear, equal, and point-on-object have deterministic priority, badges, identity-aware source/target prehighlight, committed intent, and Alt suppression. | `sketch-workspace.test.ts`; first-class workspace lifecycle in `sketch.spec.ts` |
| Shared lifecycle | Tool-first and selection-first command collection, disabled reasons, atomic apply, sketch-local undo/redo, persistence, parameter-preserving reload/edit, recompute, and finish-to-3D are covered across native entities and every P0 dimensional variant. | `p0_constraints_and_dimension_parameters_reload_and_edit_durably`; `sketch-editor.test.ts`; `sketch-ux-lifecycle.spec.ts`; `sketch.spec.ts` |

## Required release gate

```powershell
./scripts/qualify-sketch-p0.ps1 `
  -MonstertruckCheckout "E:\.cargo\git\checkouts\monstertruck-f028d4cff35aec58\4669392"
```

The script validates every pinned local package, creates the exact Cargo patch
configuration only when the repository has none, regenerates the shipped WASM,
runs the Rust/runtime/unit/build/browser gates, and removes only the temporary
configuration it created. `-SkipBrowser` is available for a focused local pass.

The browser gate runs against the generated release WASM, not a TypeScript
solver substitute. A P0 candidate is accepted only when the independent review
finds no material roadmap gap and all commands above pass.

## 2026-08-09 candidate evidence

- `cargo test -p crawler-sketch --offline` with the local Monstertruck patch:
  34 integration tests, 2 DXF workload tests, and the decomposition unit test passed.
- Focused runtime persistence/contract tests passed for P0 parameter reload/edit,
  native B-spline knots, and the 29-kind EZPZ graph contract.
- `pnpm run test:unit`: 83 passed.
- `pnpm run build`: TypeScript and Vite production build passed against the
  regenerated release WASM.
- `pnpm exec playwright test tests/sketch-ux-lifecycle.spec.ts tests/sketch.spec.ts`:
  38/38 passed against the regenerated shipped WASM in 1.7 minutes.
