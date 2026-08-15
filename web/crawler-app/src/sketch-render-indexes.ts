import type { SketchDraftView, SolveResult } from "./sketch-editor";

export type SolveComponent = NonNullable<SolveResult["solve_components"]>[number];

export type SketchRevisionIndexes = Readonly<{
  constraintIdsByGeometry: ReadonlyMap<string, readonly string[]>;
  constraintParticipationByGeometry: ReadonlyMap<string, number>;
  operationIdsByGeometry: ReadonlyMap<string, readonly string[]>;
  operationParticipationByGeometry: ReadonlyMap<string, number>;
  operationOrder: ReadonlyMap<string, number>;
  suppressedOperationGeometry: ReadonlySet<string>;
  orphanedProjectionGeometry: ReadonlySet<string>;
  constraintsVisited: number;
  operationsVisited: number;
}>;

export type SolveIndexes = Readonly<{
  componentByGeometry: ReadonlyMap<string, SolveComponent>;
  solveComponentsVisited: number;
}>;

export type SketchRenderIndexCounters = Readonly<{
  revisionIndexBuilds: number;
  revisionIndexCacheHits: number;
  solveIndexBuilds: number;
  solveIndexCacheHits: number;
  constraintsVisited: number;
  operationsVisited: number;
  solveComponentsVisited: number;
  stableLayerGenerations: number;
  geometryRendered: number;
  stableLayerGenerationTotalMs: number;
  stableLayerGenerationMaxMs: number;
}>;

function assertNever(value: never): never {
  throw new Error(`Unhandled sketch relationship kind: ${JSON.stringify(value)}`);
}

function uniqueStableIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Every geometry identity referenced by one constraint, in semantic operand order. */
export function constraintGeometryIds(constraint: SketchDraftView["constraints"][string]): readonly string[] {
  let ids: readonly string[];
  switch (constraint.kind) {
    case "coincident": ids = [constraint.a.geometry, constraint.b.geometry]; break;
    case "point_on_origin": ids = [constraint.point.geometry]; break;
    case "fixed": ids = [constraint.point.geometry]; break;
    case "fixed_geometry": ids = [constraint.geometry]; break;
    case "midpoint": ids = [constraint.point.geometry, constraint.line]; break;
    case "concentric": ids = [constraint.first, constraint.second]; break;
    case "point_on_object": ids = [constraint.point.geometry, constraint.geometry]; break;
    case "horizontal": ids = [constraint.line]; break;
    case "vertical": ids = [constraint.line]; break;
    case "horizontal_points": ids = [constraint.a.geometry, constraint.b.geometry]; break;
    case "vertical_points": ids = [constraint.a.geometry, constraint.b.geometry]; break;
    case "collinear": ids = [constraint.point.geometry, constraint.line]; break;
    case "symmetry": ids = [constraint.first.geometry, constraint.second.geometry, constraint.axis]; break;
    case "curvature_continuous": ids = [constraint.first, constraint.second]; break;
    case "parallel": ids = [constraint.first, constraint.second]; break;
    case "perpendicular": ids = [constraint.first, constraint.second]; break;
    case "tangent": ids = [constraint.first, constraint.second]; break;
    case "equal": ids = [constraint.first, constraint.second]; break;
    case "distance": ids = [constraint.a.geometry, constraint.b.geometry]; break;
    case "distance_x": ids = [constraint.a.geometry, constraint.b.geometry]; break;
    case "distance_y": ids = [constraint.a.geometry, constraint.b.geometry]; break;
    case "point_line_distance": ids = [constraint.point.geometry, constraint.line]; break;
    case "line_distance": ids = [constraint.first, constraint.second]; break;
    case "offset_distance": ids = [constraint.source, constraint.offset]; break;
    case "radius": ids = [constraint.geometry]; break;
    case "diameter": ids = [constraint.geometry]; break;
    case "ellipse_radius": ids = [constraint.geometry]; break;
    case "angle": ids = [constraint.first, constraint.second]; break;
    case "angle_to_axis": ids = [constraint.line]; break;
    default: return assertNever(constraint);
  }
  // A relation participates once per geometry even when two operands reference it.
  return uniqueStableIds(ids);
}

/** Geometry owned or referenced by a retained sketch operation. */
export function retainedOperationGeometry(
  operation: NonNullable<SketchDraftView["operations"]>[string],
): readonly string[] {
  let ids: readonly string[];
  switch (operation.kind) {
    case "offset": ids = [...operation.sources, ...operation.result_chains.flat()]; break;
    case "mirror": ids = [...operation.sources, ...operation.results]; break;
    case "linear_pattern": ids = [...operation.sources, ...operation.instances.flat()]; break;
    case "circular_pattern": ids = [...operation.sources, ...operation.instances.flat()]; break;
    case "fillet": ids = [operation.first, operation.second, operation.result]; break;
    case "chamfer": ids = [operation.first, operation.second, operation.result]; break;
    case "break": ids = [operation.source, ...operation.results]; break;
    case "scale": ids = [...operation.sources, ...operation.results]; break;
    case "move_copy": ids = [...operation.sources, ...operation.results]; break;
    case "blend": ids = [operation.first, operation.second, operation.result]; break;
    case "project_include": ids = [...operation.results]; break;
    default: return assertNever(operation);
  }
  return uniqueStableIds(ids);
}

function appendIndex(index: Map<string, string[]>, geometry: string, relationship: string): void {
  const relationships = index.get(geometry);
  if (relationships) relationships.push(relationship);
  else index.set(geometry, [relationship]);
}

/** Build all draft-owned render relationship indexes in one deterministic pass. */
export function buildSketchRevisionIndexes(
  sketch: Pick<SketchDraftView, "constraints" | "operations">,
): SketchRevisionIndexes {
  const constraintIdsByGeometry = new Map<string, string[]>();
  const operationIdsByGeometry = new Map<string, string[]>();
  const operationOrder = new Map<string, number>();
  const suppressedOperationGeometry = new Set<string>();
  const orphanedProjectionGeometry = new Set<string>();
  const constraintEntries = Object.entries(sketch.constraints);
  const operationEntries = Object.entries(sketch.operations ?? {});

  for (const [constraintId, constraint] of constraintEntries) {
    for (const geometryId of constraintGeometryIds(constraint)) {
      appendIndex(constraintIdsByGeometry, geometryId, constraintId);
    }
  }
  for (const [index, [operationId, operation]] of operationEntries.entries()) {
    operationOrder.set(operationId, index);
    for (const geometryId of retainedOperationGeometry(operation)) {
      appendIndex(operationIdsByGeometry, geometryId, operationId);
    }
    if (operation.kind === "linear_pattern" || operation.kind === "circular_pattern") {
      for (const instance of operation.suppressed_instances) {
        operation.instances[instance - 1]?.forEach((id) => suppressedOperationGeometry.add(id));
      }
    }
    if (operation.kind === "project_include" && operation.missing) {
      operation.results.forEach((id) => orphanedProjectionGeometry.add(id));
    }
  }

  return {
    constraintIdsByGeometry,
    constraintParticipationByGeometry: new Map(
      [...constraintIdsByGeometry].map(([geometry, ids]) => [geometry, ids.length]),
    ),
    operationIdsByGeometry,
    operationParticipationByGeometry: new Map(
      [...operationIdsByGeometry].map(([geometry, ids]) => [geometry, ids.length]),
    ),
    operationOrder,
    suppressedOperationGeometry,
    orphanedProjectionGeometry,
    constraintsVisited: constraintEntries.length,
    operationsVisited: operationEntries.length,
  };
}

/** Build first-component-wins solve lookup, matching the prior Array.find behavior. */
export function buildSolveIndexes(solve?: Readonly<SolveResult>): SolveIndexes {
  const componentByGeometry = new Map<string, SolveComponent>();
  const components = solve?.solve_components ?? [];
  for (const component of components) {
    for (const geometryId of component.geometry) {
      if (!componentByGeometry.has(geometryId)) componentByGeometry.set(geometryId, component as SolveComponent);
    }
  }
  return { componentByGeometry, solveComponentsVisited: components.length };
}

/** Preserve operation insertion precedence across any geometry selection order. */
export function firstRetainedOperationId(
  indexes: Pick<SketchRevisionIndexes, "operationIdsByGeometry" | "operationOrder">,
  selectedGeometry: readonly string[],
): string | undefined {
  let first: string | undefined;
  let firstOrder = Number.POSITIVE_INFINITY;
  for (const geometryId of selectedGeometry) {
    for (const operationId of indexes.operationIdsByGeometry.get(geometryId) ?? []) {
      const order = indexes.operationOrder.get(operationId) ?? Number.POSITIVE_INFINITY;
      if (order < firstOrder) {
        first = operationId;
        firstOrder = order;
      }
    }
  }
  return first;
}

/** Bounded, last-identity cache. It never infers freshness from numeric revisions. */
export class SketchRenderIndexCache {
  private draft?: SketchDraftView;
  private revisionIndexes?: SketchRevisionIndexes;
  private solve?: Readonly<SolveResult>;
  private solveWasUndefined = false;
  private solveIndexes?: SolveIndexes;
  private countersValue = {
    revisionIndexBuilds: 0,
    revisionIndexCacheHits: 0,
    solveIndexBuilds: 0,
    solveIndexCacheHits: 0,
    constraintsVisited: 0,
    operationsVisited: 0,
    solveComponentsVisited: 0,
    stableLayerGenerations: 0,
    geometryRendered: 0,
    stableLayerGenerationTotalMs: 0,
    stableLayerGenerationMaxMs: 0,
  };

  resolveDraft(draft: SketchDraftView): SketchRevisionIndexes {
    if (this.draft === draft && this.revisionIndexes) {
      this.countersValue.revisionIndexCacheHits += 1;
      return this.revisionIndexes;
    }
    const indexes = buildSketchRevisionIndexes(draft);
    this.draft = draft;
    this.revisionIndexes = indexes;
    this.countersValue.revisionIndexBuilds += 1;
    this.countersValue.constraintsVisited += indexes.constraintsVisited;
    this.countersValue.operationsVisited += indexes.operationsVisited;
    return indexes;
  }

  resolveSolve(solve?: Readonly<SolveResult>): SolveIndexes {
    if (this.solveIndexes && ((solve === undefined && this.solveWasUndefined) || solve === this.solve)) {
      this.countersValue.solveIndexCacheHits += 1;
      return this.solveIndexes;
    }
    const indexes = buildSolveIndexes(solve);
    this.solve = solve;
    this.solveWasUndefined = solve === undefined;
    this.solveIndexes = indexes;
    this.countersValue.solveIndexBuilds += 1;
    this.countersValue.solveComponentsVisited += indexes.solveComponentsVisited;
    return indexes;
  }

  counters(): SketchRenderIndexCounters {
    return { ...this.countersValue };
  }

  recordStableLayerGeneration(durationMs: number, geometryCount: number): void {
    this.countersValue.stableLayerGenerations += 1;
    this.countersValue.geometryRendered += geometryCount;
    this.countersValue.stableLayerGenerationTotalMs += durationMs;
    this.countersValue.stableLayerGenerationMaxMs = Math.max(
      this.countersValue.stableLayerGenerationMaxMs,
      durationMs,
    );
  }

  invalidate(): void {
    this.draft = undefined;
    this.revisionIndexes = undefined;
    this.solve = undefined;
    this.solveWasUndefined = false;
    this.solveIndexes = undefined;
  }
}
