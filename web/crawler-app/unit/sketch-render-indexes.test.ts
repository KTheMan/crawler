import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSketchRevisionIndexes,
  buildSolveIndexes,
  constraintGeometryIds,
  firstRetainedOperationId,
  retainedOperationGeometry,
  SketchRenderIndexCache,
} from "../src/sketch-render-indexes.ts";
import type { Constraint, Sketch, SketchOperation, SolveResult } from "../src/sketch-editor.ts";

const point = (geometry: string) => ({ geometry, anchor: "start" as const });

const constraintCases: Array<[Constraint, readonly string[]]> = [
  [{ kind: "coincident", a: point("a"), b: point("b") }, ["a", "b"]],
  [{ kind: "point_on_origin", point: point("a") }, ["a"]],
  [{ kind: "fixed", point: point("a"), x_nm: 1, y_nm: 2 }, ["a"]],
  [{ kind: "fixed_geometry", geometry: "a" }, ["a"]],
  [{ kind: "midpoint", point: point("a"), line: "b" }, ["a", "b"]],
  [{ kind: "concentric", first: "a", second: "b" }, ["a", "b"]],
  [{ kind: "point_on_object", point: point("a"), geometry: "b" }, ["a", "b"]],
  [{ kind: "horizontal", line: "a" }, ["a"]],
  [{ kind: "vertical", line: "a" }, ["a"]],
  [{ kind: "horizontal_points", a: point("a"), b: point("b") }, ["a", "b"]],
  [{ kind: "vertical_points", a: point("a"), b: point("b") }, ["a", "b"]],
  [{ kind: "collinear", point: point("a"), line: "b" }, ["a", "b"]],
  [{ kind: "symmetry", first: point("a"), second: point("b"), axis: "c" }, ["a", "b", "c"]],
  [{ kind: "curvature_continuous", first: "a", second: "b" }, ["a", "b"]],
  [{ kind: "parallel", first: "a", second: "b" }, ["a", "b"]],
  [{ kind: "perpendicular", first: "a", second: "b" }, ["a", "b"]],
  [{ kind: "tangent", first: "a", second: "b", first_parameter_millionths: 1 }, ["a", "b"]],
  [{ kind: "equal", first: "a", second: "b" }, ["a", "b"]],
  [{ kind: "distance", a: point("a"), b: point("b"), distance_nm: 1 }, ["a", "b"]],
  [{ kind: "distance_x", a: point("a"), b: point("b"), distance_nm: 1 }, ["a", "b"]],
  [{ kind: "distance_y", a: point("a"), b: point("b"), distance_nm: 1 }, ["a", "b"]],
  [{ kind: "point_line_distance", point: point("a"), line: "b", distance_nm: 1 }, ["a", "b"]],
  [{ kind: "line_distance", first: "a", second: "b", distance_nm: 1 }, ["a", "b"]],
  [{ kind: "offset_distance", source: "a", offset: "b", distance_nm: 1, source_start_millionths: 0, source_end_millionths: 1_000_000 }, ["a", "b"]],
  [{ kind: "radius", geometry: "a", radius_nm: 1 }, ["a"]],
  [{ kind: "diameter", geometry: "a", diameter_nm: 1 }, ["a"]],
  [{ kind: "ellipse_radius", geometry: "a", axis: "major", radius_nm: 1 }, ["a"]],
  [{ kind: "angle", first: "a", second: "b", angle_microdegrees: 1 }, ["a", "b"]],
  [{ kind: "angle_to_axis", line: "a", axis: "x", angle_microdegrees: 1 }, ["a"]],
];

test("constraint geometry extraction is exhaustive, ordered, and unique", () => {
  assert.equal(constraintCases.length, 29);
  for (const [constraint, expected] of constraintCases) {
    assert.deepEqual(constraintGeometryIds(constraint), expected, constraint.kind);
  }
  assert.deepEqual(
    constraintGeometryIds({ kind: "coincident", a: point("same"), b: point("same") }),
    ["same"],
  );
});

const operationCases: Array<[SketchOperation, readonly string[]]> = [
  [{ kind: "offset", sources: ["a"], result_chains: [["b", "c"]], distance_nm: 1, two_sided: false, linked: true }, ["a", "b", "c"]],
  [{ kind: "mirror", sources: ["a"], axis: "axis", results: ["b"], linked: true }, ["a", "b"]],
  [{ kind: "linear_pattern", sources: ["a"], instances: [["b"], ["c"]], count: 3, spacing: { x_nm: 1, y_nm: 2 }, extent: false, suppressed_instances: [2] }, ["a", "b", "c"]],
  [{ kind: "circular_pattern", sources: ["a"], instances: [["b"], ["c"]], center: { x_nm: 0, y_nm: 0 }, count: 3, angle_microdegrees: 360_000_000, suppressed_instances: [] }, ["a", "b", "c"]],
  [{ kind: "fillet", first: "a", second: "b", result: "c", radius_nm: 1 }, ["a", "b", "c"]],
  [{ kind: "chamfer", first: "a", second: "b", result: "c", first_distance_nm: 1, second_distance_nm: 1, angle_microdegrees: 45_000_000, mode: "equal_distance" }, ["a", "b", "c"]],
  [{ kind: "break", source: "a", results: ["b", "c"], parameters_millionths: [500_000] }, ["a", "b", "c"]],
  [{ kind: "scale", sources: ["a"], results: ["b"], originals: [], center: { x_nm: 0, y_nm: 0 }, factor_millionths: 2_000_000, copy: true }, ["a", "b"]],
  [{ kind: "move_copy", sources: ["a"], results: ["b"], originals: [], delta: { x_nm: 1, y_nm: 2 }, copy: true }, ["a", "b"]],
  [{ kind: "blend", first: "a", second: "b", result: "c", continuity: "tangent", magnitude_nm: 1 }, ["a", "b", "c"]],
  [{ kind: "project_include", source_kind: "edge", source_ids: ["source"], results: ["a"], linked: true, locked: false, intersect_plane: false, missing: false }, ["a"]],
];

test("retained operation extraction covers every operation without inventing operands", () => {
  assert.equal(operationCases.length, 11);
  for (const [operation, expected] of operationCases) {
    assert.deepEqual(retainedOperationGeometry(operation), expected, operation.kind);
  }
  assert.deepEqual(retainedOperationGeometry(operationCases[1][0]), ["a", "b"], "mirror axis is not retained result geometry");
});

function emptySketch(overrides: Partial<Sketch> = {}): Sketch {
  return { id: "sketch", revision: 1, geometry: {}, constraints: {}, ...overrides };
}

test("revision indexes preserve relationship order, suppression, orphaning, and exact counts", () => {
  const indexes = buildSketchRevisionIndexes(emptySketch({
    constraints: {
      second: { kind: "parallel", first: "shared", second: "line-b" },
      duplicate_operand: { kind: "coincident", a: point("shared"), b: point("shared") },
    },
    operations: {
      first_operation: { kind: "linear_pattern", sources: ["shared"], instances: [["instance-1"], ["instance-2"]], count: 3, spacing: { x_nm: 1, y_nm: 0 }, extent: false, suppressed_instances: [2, 2, 0, 99] },
      missing_projection: { kind: "project_include", source_kind: "edge", source_ids: ["edge"], results: ["shared", "orphan"], linked: true, locked: false, intersect_plane: false, missing: true },
    },
  }));

  assert.deepEqual(indexes.constraintIdsByGeometry.get("shared"), ["second", "duplicate_operand"]);
  assert.equal(indexes.constraintParticipationByGeometry.get("shared"), 2);
  assert.deepEqual(indexes.operationIdsByGeometry.get("shared"), ["first_operation", "missing_projection"]);
  assert.equal(indexes.operationParticipationByGeometry.get("shared"), 2);
  assert.deepEqual([...indexes.suppressedOperationGeometry], ["instance-2"]);
  assert.deepEqual([...indexes.orphanedProjectionGeometry], ["shared", "orphan"]);
  assert.equal(indexes.constraintsVisited, 2);
  assert.equal(indexes.operationsVisited, 2);
  assert.equal(firstRetainedOperationId(indexes, ["orphan", "shared"]), "first_operation", "operation insertion order wins over selection order");
});

test("solve indexes preserve first-component-wins behavior", () => {
  const components: NonNullable<SolveResult["solve_components"]> = [
    { id: 1, geometry: ["a", "shared"], constraints: [], variable_count: 1, equation_count: 0, structural_rank: 0, structural_degrees_of_freedom: 1, structurally_redundant_equations: 0 },
    { id: 2, geometry: ["shared", "b"], constraints: [], variable_count: 2, equation_count: 0, structural_rank: 0, structural_degrees_of_freedom: 2, structurally_redundant_equations: 0 },
  ];
  const solve = { state: "under_constrained", degrees_of_freedom: 3, solve_components: components, active_constraints: [], redundant_constraints: [], conflicts: [] } satisfies SolveResult;
  const indexes = buildSolveIndexes(solve);
  assert.equal(indexes.componentByGeometry.get("shared")?.id, 1);
  assert.equal(indexes.componentByGeometry.get("b")?.id, 2);
  assert.equal(indexes.solveComponentsVisited, 2);
  assert.equal(buildSolveIndexes().componentByGeometry.size, 0);
});

test("bounded cache keys on object identity and reports phase-local work", () => {
  const cache = new SketchRenderIndexCache();
  const first = emptySketch({ constraints: { fixed: { kind: "fixed_geometry", geometry: "a" } } });
  const sameRevisionNewIdentity = emptySketch({ constraints: { horizontal: { kind: "horizontal", line: "b" } } });
  const solve = { state: "fully_constrained", degrees_of_freedom: 0, solve_components: [], active_constraints: [], redundant_constraints: [], conflicts: [] } satisfies SolveResult;

  const firstIndexes = cache.resolveDraft(first);
  assert.equal(cache.resolveDraft(first), firstIndexes);
  assert.notEqual(cache.resolveDraft(sameRevisionNewIdentity), firstIndexes, "numeric revision must not be cache authority");
  const firstSolveIndexes = cache.resolveSolve(solve);
  assert.equal(cache.resolveSolve(solve), firstSolveIndexes);
  cache.recordStableLayerGeneration(3.5, 4);
  assert.deepEqual(cache.counters(), {
    revisionIndexBuilds: 2,
    revisionIndexCacheHits: 1,
    solveIndexBuilds: 1,
    solveIndexCacheHits: 1,
    constraintsVisited: 2,
    operationsVisited: 0,
    solveComponentsVisited: 0,
    stableLayerGenerations: 1,
    geometryRendered: 4,
    stableLayerGenerationTotalMs: 3.5,
    stableLayerGenerationMaxMs: 3.5,
  });
  cache.invalidate();
  assert.notEqual(cache.resolveDraft(first), firstIndexes);
});
