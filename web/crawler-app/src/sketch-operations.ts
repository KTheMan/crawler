import type { Geometry, GeometryEntity, Point2, Sketch, SketchCommand, StableId, StableSketchIds } from "./sketch-editor";
import { evaluateGeometryCurve, projectPointToEllipse } from "./sketch-spline.ts";

const TAU = Math.PI * 2;

export function splineCommands(ids: StableSketchIds, points: readonly Point2[]): SketchCommand[] {
  if (points.length !== 4) throw new Error("Spline requires four control points");
  return [{
    kind: "add_geometry",
    entity: {
      id: ids.next("geometry"),
      geometry: { kind: "control_point_spline", degree: 3, control_points: points.map((point) => ({ ...point })), knots_millionths: [0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000] },
    },
  }];
}

export function fitSplineCommands(ids: StableSketchIds, points: readonly Point2[]): SketchCommand[] {
  if (points.length !== 4) throw new Error("Fit point spline requires four points");
  return [{ kind: "add_geometry", entity: { id: ids.next("geometry"), geometry: { kind: "fit_point_spline", fit_points: points.map((point) => ({ ...point })) } } }];
}

export function conicCommands(ids: StableSketchIds, start: Point2, control: Point2, end: Point2, weightMillionths = 1_000_000): SketchCommand[] {
  if (start.x_nm === end.x_nm && start.y_nm === end.y_nm) throw new Error("Conic endpoints must be distinct");
  if (weightMillionths <= 0) throw new Error("Conic weight must be positive");
  return [{ kind: "add_geometry", entity: { id: ids.next("geometry"), geometry: { kind: "conic", start: { ...start }, control: { ...control }, end: { ...end }, weight_millionths: Math.round(weightMillionths) } } }];
}

export function pointCommands(ids: StableSketchIds, position: Point2): SketchCommand[] {
  return [{ kind: "add_geometry", entity: { id: ids.next("geometry"), geometry: { kind: "sketch_point", x_nm: position.x_nm, y_nm: position.y_nm } } }];
}

export function polygonCommands(ids: StableSketchIds, center: Point2, vertex: Point2, sides = 6): SketchCommand[] {
  if (sides < 3) throw new Error("Polygon requires at least three sides");
  const radius = distance(center, vertex);
  if (!radius) throw new Error("Polygon radius must be positive");
  const start = Math.atan2(vertex.y_nm - center.y_nm, vertex.x_nm - center.x_nm);
  const points = Array.from({ length: sides }, (_, index) => pointOnCircle(center, radius, start + TAU * index / sides));
  const recipeId = ids.next("recipe");
  const commands = polylineCommands(ids, points, true);
  const lineIds = commands.filter((command): command is Extract<SketchCommand, { kind: "add_geometry" }> => command.kind === "add_geometry").map((command) => command.entity.id);
  for (let index = 1; index < lineIds.length; index += 1) commands.push({ kind: "add_constraint", id: `recipe:${recipeId}:equal:${index}`, constraint: { kind: "equal", first: lineIds[0], second: lineIds[index] } });
  const turn = Math.round(360_000_000 / sides);
  for (let index = 0; index < lineIds.length; index += 1) {
    const id = `recipe:${recipeId}:angle:${index}`;
    commands.push({ kind: "add_constraint", id, constraint: { kind: "angle", first: lineIds[index], second: lineIds[(index + 1) % lineIds.length], angle_microdegrees: turn } });
    commands.push({ kind: "set_constraint_suppressed", constraint: id, suppressed: true });
  }
  commands.push({ kind: "add_recipe", id: recipeId, recipe: {
    kind: "polygon",
    center: { ...center },
    radius_nm: Math.round(radius),
    sides,
    orientation_microdegrees: Math.round(start * 180 / Math.PI * 1_000_000),
    geometry: lineIds,
  } });
  return commands;
}

export function ellipseCommands(ids: StableSketchIds, center: Point2, major: Point2, minor: Point2): SketchCommand[] {
  const axis = unit(center, major); const normal = { x: -axis.y, y: axis.x };
  const signedMinorRadius = (minor.x_nm - center.x_nm) * normal.x + (minor.y_nm - center.y_nm) * normal.y;
  if (!distance(center, major) || Math.abs(signedMinorRadius) < 1) throw new Error("Ellipse axes must be perpendicular and positive");
  const principalMinor = offset(center, normal, signedMinorRadius);
  const [canonicalMajor, canonicalMinor] = canonicalEllipseAxes(center, major, principalMinor);
  return [{ kind: "add_geometry", entity: { id: ids.next("geometry"), geometry: { kind: "ellipse", center: { ...center }, major: canonicalMajor, minor: canonicalMinor } } }];
}

export function ellipticalArcCommands(ids: StableSketchIds, center: Point2, major: Point2, minor: Point2, startTarget: Point2, endTarget: Point2, clockwise = false): SketchCommand[] {
  const axis = unit(center, major); const normal = { x: -axis.y, y: axis.x };
  const signedMinorRadius = (minor.x_nm - center.x_nm) * normal.x + (minor.y_nm - center.y_nm) * normal.y;
  if (!distance(center, major) || Math.abs(signedMinorRadius) < 1) throw new Error("Elliptical arc axes must be perpendicular and positive");
  const principalMinor = offset(center, normal, signedMinorRadius);
  const [canonicalMajor, canonicalMinor] = canonicalEllipseAxes(center, major, principalMinor);
  const start = projectPointToEllipse(center, canonicalMajor, canonicalMinor, startTarget);
  const end = projectPointToEllipse(center, canonicalMajor, canonicalMinor, endTarget);
  if (start.x_nm === end.x_nm && start.y_nm === end.y_nm) throw new Error("Elliptical arc endpoints must be distinct");
  return [{ kind: "add_geometry", entity: { id: ids.next("geometry"), geometry: { kind: "elliptical_arc", center: { ...center }, major: canonicalMajor, minor: canonicalMinor, start, end, clockwise } } }];
}

function canonicalEllipseAxes(center: Point2, first: Point2, second: Point2): [Point2, Point2] {
  return distance(center, first) >= distance(center, second)
    ? [{ ...first }, { ...second }]
    : [{ ...second }, { ...first }];
}

export function slotCommands(ids: StableSketchIds, first: Point2, second: Point2, widthPoint: Point2): SketchCommand[] {
  const axis = unit(first, second); const normal = { x: -axis.y, y: axis.x };
  const radius = Math.abs((widthPoint.x_nm - first.x_nm) * normal.x + (widthPoint.y_nm - first.y_nm) * normal.y);
  if (!radius || distance(first, second) === 0) throw new Error("Slot length and width must be positive");
  const aTop = offset(first, normal, radius); const bTop = offset(second, normal, radius);
  const aBottom = offset(first, normal, -radius); const bBottom = offset(second, normal, -radius);
  const top = ids.next("geometry"); const endArc = ids.next("geometry"); const bottom = ids.next("geometry"); const startArc = ids.next("geometry");
  const commands: SketchCommand[] = [
    addLine(top, aTop, bTop),
    { kind: "add_geometry", entity: { id: endArc, geometry: { kind: "arc", center: second, start: bTop, end: bBottom, clockwise: true } } },
    addLine(bottom, bBottom, aBottom),
    { kind: "add_geometry", entity: { id: startArc, geometry: { kind: "arc", center: first, start: aBottom, end: aTop, clockwise: true } } },
  ];
  const refs: Array<[StableId, "start" | "end", StableId, "start" | "end"]> = [[top, "end", endArc, "start"], [endArc, "end", bottom, "start"], [bottom, "end", startArc, "start"], [startArc, "end", top, "start"]];
  for (const [a, aa, b, ba] of refs) commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "coincident", a: { geometry: a, anchor: aa }, b: { geometry: b, anchor: ba } } });
  commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "parallel", first: top, second: bottom } });
  commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "equal", first: endArc, second: startArc } });
  // Retain every line/cap relationship explicitly. Two are independent driving
  // constraints; the dependent pair remains editable as reference intent
  // rather than disappearing from the canonical construction.
  for (const [index, [line, arc]] of [[top, endArc], [bottom, endArc], [bottom, startArc], [top, startArc]].entries()) {
    const tangent = ids.next("constraint");
    commands.push({ kind: "add_constraint", id: tangent, constraint: { kind: "tangent", first: line, second: arc } });
    if (index === 1 || index === 3) commands.push({ kind: "set_constraint_suppressed", constraint: tangent, suppressed: true });
  }
  // These measurements describe the retained slot recipe, but are dependent on
  // the tangent/equal/parallel construction above. Store them as reference
  // dimensions so the slot remains inspectable without over-constraining the
  // solver graph.
  const lengthDimension = ids.next("constraint");
  commands.push({ kind: "add_constraint", id: lengthDimension, constraint: { kind: "distance", a: { geometry: top, anchor: "start" }, b: { geometry: top, anchor: "end" }, distance_nm: Math.round(distance(first, second)) } });
  commands.push({ kind: "set_constraint_suppressed", constraint: lengthDimension, suppressed: true });
  const widthDimension = ids.next("constraint");
  commands.push({ kind: "add_constraint", id: widthDimension, constraint: { kind: "line_distance", first: top, second: bottom, distance_nm: Math.round(radius * 2) } });
  commands.push({ kind: "set_constraint_suppressed", constraint: widthDimension, suppressed: true });
  const radiusDimension = ids.next("constraint");
  commands.push({ kind: "add_constraint", id: radiusDimension, constraint: { kind: "radius", geometry: endArc, radius_nm: Math.round(radius) } });
  commands.push({ kind: "set_constraint_suppressed", constraint: radiusDimension, suppressed: true });
  commands.push({ kind: "add_recipe", id: ids.next("recipe"), recipe: {
    kind: "slot",
    first: { ...first },
    second: { ...second },
    radius_nm: Math.round(radius),
    geometry: [top, endArc, bottom, startArc],
  } });
  return commands;
}

export type OffsetChainInstrumentation = {
  sceneGeometryVisits: number;
  orderingGeometryVisits: number;
  endpointGeometryCount: number;
  endpointKeyCount: number;
  endpointIncidenceCount: number;
  invalidEndpointGeometryCount: number;
  bfsDequeues: number;
  adjacencyVisits: number;
  reachableGeometryCount: number;
  bfsLevels: number;
  rejectedSeedGeometryCount: number;
};

export type ConnectedOffsetChainPlan = {
  sources: StableId[];
  instrumentation: OffsetChainInstrumentation;
  rejection?: {
    geometry: StableId;
    reason: "nonfinite_endpoint" | "degenerate_endpoint" | "branched_endpoint" | "disconnected_endpoint_component";
  };
};

type OffsetCommandOptions = {
  twoSided?: boolean;
  linked?: boolean;
  /** Reuse a caller-owned plan so preview validation and command construction do not traverse the scene twice. */
  chainPlan?: ConnectedOffsetChainPlan;
  /** Optional phase-local sink used by performance tests; it does not affect planning. */
  chainInstrumentation?: OffsetChainInstrumentation;
};

/**
 * Creates only durable offset intent. Result topology and geometry are owned
 * by the kernel preview, so the UI never performs a second sampled native
 * curve approximation on the main thread.
 */
export function canonicalOffsetCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, distanceNm: number, options: OffsetCommandOptions = {}): SketchCommand[] {
  const chain = options.chainPlan ?? planConnectedOffsetChain(sketch, selected.filter((id) => id in sketch.geometry));
  if (options.chainInstrumentation) Object.assign(options.chainInstrumentation, chain.instrumentation);
  if (chain.rejection || !chain.sources.length || !distanceNm || options.linked === false) return [];
  const groups = chain.sources.length * (options.twoSided ? 2 : 1);
  return [{
    kind: "add_operation",
    id: ids.next("operation"),
    operation: {
      kind: "offset",
      sources: chain.sources,
      // One stable seed per group keeps the request compatible with legacy
      // runtimes. The worker replaces its geometry and expands/truncates each
      // chain to the canonical result topology before returning the preview.
      result_chains: Array.from({ length: groups }, () => [ids.next("geometry")]),
      // v2 is an explicit contract: the kernel must certify durable output at
      // model tolerance and owns the source-span metadata it publishes.
      model_tolerance_nm: 1_000,
      result_spans: Array.from({ length: groups }, () => []),
      distance_nm: Math.round(distanceNm),
      two_sided: Boolean(options.twoSided),
      linked: true,
    },
  }];
}

/**
 * Plan an offset chain in O(geometry + endpoint incidence) work.
 *
 * The old implementation rescanned every geometry for every expansion wave. We
 * retain its observable ordering by computing shortest endpoint-graph distance
 * once, then emitting each distance level in sketch insertion order.
 */
export function planConnectedOffsetChain(sketch: Sketch, seed: readonly StableId[]): ConnectedOffsetChainPlan {
  const instrumentation: OffsetChainInstrumentation = {
    sceneGeometryVisits: 0,
    orderingGeometryVisits: 0,
    endpointGeometryCount: 0,
    endpointKeyCount: 0,
    endpointIncidenceCount: 0,
    invalidEndpointGeometryCount: 0,
    bfsDequeues: 0,
    adjacencyVisits: 0,
    reachableGeometryCount: 0,
    bfsLevels: 0,
    rejectedSeedGeometryCount: 0,
  };
  const entries = Object.entries(sketch.geometry);
  const seedIds = [...new Set(seed.filter((id) => id in sketch.geometry))];
  const endpointKeysByGeometry = new Map<StableId, string[]>();
  const geometryByEndpoint = new Map<string, StableId[]>();
  const invalid = new Map<StableId, "nonfinite_endpoint" | "degenerate_endpoint">();

  for (const [id, entity] of entries) {
    instrumentation.sceneGeometryVisits += 1;
    const endpointResult = offsetChainEndpointKeys(entity.geometry);
    if (endpointResult.reason) {
      invalid.set(id, endpointResult.reason);
      instrumentation.invalidEndpointGeometryCount += 1;
      continue;
    }
    const keys = endpointResult.keys;
    endpointKeysByGeometry.set(id, keys);
    if (keys.length) instrumentation.endpointGeometryCount += 1;
    for (const key of keys) {
      let incidence = geometryByEndpoint.get(key);
      if (!incidence) {
        incidence = [];
        geometryByEndpoint.set(key, incidence);
      }
      incidence.push(id);
      instrumentation.endpointIncidenceCount += 1;
    }
  }
  instrumentation.endpointKeyCount = geometryByEndpoint.size;

  for (const id of seedIds) {
    const reason = invalid.get(id);
    if (!reason) continue;
    instrumentation.rejectedSeedGeometryCount += 1;
    return { sources: [], instrumentation, rejection: { geometry: id, reason } };
  }

  const distanceByGeometry = new Map<StableId, number>();
  // The first BFS visit to an endpoint key is necessarily at its minimum
  // graph distance. Consuming that incidence bucket once avoids O(E²) work
  // when many entities share the same endpoint (for example a radial hub).
  const consumedEndpointKeys = new Set<string>();
  const queue: StableId[] = [];
  for (const id of seedIds) {
    distanceByGeometry.set(id, 0);
    queue.push(id);
  }
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const id = queue[queueIndex++];
    instrumentation.bfsDequeues += 1;
    const nextDistance = (distanceByGeometry.get(id) ?? 0) + 1;
    for (const key of endpointKeysByGeometry.get(id) ?? []) {
      if (consumedEndpointKeys.has(key)) continue;
      consumedEndpointKeys.add(key);
      for (const connectedId of geometryByEndpoint.get(key) ?? []) {
        instrumentation.adjacencyVisits += 1;
        if (distanceByGeometry.has(connectedId)) continue;
        const connected = sketch.geometry[connectedId];
        if (connected.construction || connected.id.startsWith("external:")) continue;
        distanceByGeometry.set(connectedId, nextDistance);
        queue.push(connectedId);
        instrumentation.bfsLevels = Math.max(instrumentation.bfsLevels, nextDistance);
      }
    }
  }
  instrumentation.reachableGeometryCount = distanceByGeometry.size;

  const reachable = new Set(distanceByGeometry.keys());
  const reachableInSceneOrder: StableId[] = [];
  for (const [id] of entries) {
    instrumentation.orderingGeometryVisits += 1;
    if (reachable.has(id)) reachableInSceneOrder.push(id);
  }

  // A durable offset operation represents one unambiguous chain. Reject a
  // branch before the kernel has to guess which continuation to join.
  for (const [key, incidence] of geometryByEndpoint) {
    const members = incidence.filter((id) => reachable.has(id));
    if (members.length > 2) {
      const geometry = [...members].sort()[0];
      return { sources: [], instrumentation, rejection: { geometry, reason: "branched_endpoint" } };
    }
  }

  if (!reachableInSceneOrder.length) return { sources: [], instrumentation };

  // Verify that multiple selected seeds did not create a union of disconnected
  // endpoint components (or mix a closed primitive with an open chain).
  const connected = new Set<StableId>();
  const componentQueue = [reachableInSceneOrder[0]];
  for (let index = 0; index < componentQueue.length; index += 1) {
    const id = componentQueue[index];
    if (connected.has(id)) continue;
    connected.add(id);
    for (const key of endpointKeysByGeometry.get(id) ?? []) {
      for (const adjacent of geometryByEndpoint.get(key) ?? []) {
        if (reachable.has(adjacent) && !connected.has(adjacent)) componentQueue.push(adjacent);
      }
    }
  }
  if (connected.size !== reachable.size) {
    const geometry = reachableInSceneOrder.find((id) => !connected.has(id))!;
    return { sources: [], instrumentation, rejection: { geometry, reason: "disconnected_endpoint_component" } };
  }

  // A single closed primitive has no endpoint graph and is already ordered.
  if (reachable.size === 1 && !(endpointKeysByGeometry.get(reachableInSceneOrder[0])?.length)) {
    return { sources: reachableInSceneOrder, instrumentation };
  }

  const endpointIncidence = (key: string) => (geometryByEndpoint.get(key) ?? []).filter((id) => reachable.has(id));
  const terminalChoices = reachableInSceneOrder.flatMap((id) =>
    (endpointKeysByGeometry.get(id) ?? [])
      .filter((key) => endpointIncidence(key).length === 1)
      .map((key) => ({ id, key })),
  ).sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  const startId = terminalChoices[0]?.id ?? [...reachable].sort()[0];
  let incomingKey = terminalChoices[0]?.key
    ?? [...(endpointKeysByGeometry.get(startId) ?? [])].sort()[0];
  const ordered: StableId[] = [];
  const visited = new Set<StableId>();
  let current: StableId | undefined = startId;
  while (current && !visited.has(current)) {
    ordered.push(current);
    visited.add(current);
    const keys: string[] = endpointKeysByGeometry.get(current) ?? [];
    const exitKey: string | undefined = keys.find((key: string) => key !== incomingKey);
    if (!exitKey) break;
    const next: StableId | undefined = endpointIncidence(exitKey).filter((id) => id !== current && !visited.has(id)).sort()[0];
    incomingKey = exitKey;
    current = next;
  }
  if (ordered.length !== reachable.size) {
    const geometry = reachableInSceneOrder.find((id) => !visited.has(id))!;
    return { sources: [], instrumentation, rejection: { geometry, reason: "disconnected_endpoint_component" } };
  }
  return { sources: ordered, instrumentation };
}

function offsetChainEndpointKeys(geometry: Geometry): { keys: string[]; reason?: "nonfinite_endpoint" | "degenerate_endpoint" } {
  let points: Point2[] = [];
  if (geometry.kind === "line" || geometry.kind === "arc" || geometry.kind === "conic") points = [geometry.start, geometry.end];
  else if (geometry.kind === "control_point_spline") {
    if (geometry.control_points.length < 2) return { keys: [], reason: "degenerate_endpoint" };
    points = [geometry.control_points[0], geometry.control_points.at(-1)!];
  } else if (geometry.kind === "fit_point_spline") {
    if (geometry.fit_points.length < 2) return { keys: [], reason: "degenerate_endpoint" };
    points = [geometry.fit_points[0], geometry.fit_points.at(-1)!];
  } else if (geometry.kind === "elliptical_arc") points = [geometry.start, geometry.end];
  if (points.some((point) => !Number.isFinite(point.x_nm) || !Number.isFinite(point.y_nm))) return { keys: [], reason: "nonfinite_endpoint" };
  if (points.length === 2 && points[0].x_nm === points[1].x_nm && points[0].y_nm === points[1].y_nm) return { keys: [], reason: "degenerate_endpoint" };
  return { keys: [...new Set(points.map((point) => `${point.x_nm}:${point.y_nm}`))] };
}


export function extendCommands(sketch: Sketch, selected: readonly StableId[], distanceNm: number): SketchCommand[] {
  return selected.flatMap((id) => {
    const geometry = sketch.geometry[id]?.geometry;
    if (geometry?.kind !== "line") return [];
    const direction = unit(geometry.start, geometry.end);
    return [{ kind: "move_point", point: { geometry: id, anchor: "end" }, to: offset(geometry.end, direction, distanceNm) } as SketchCommand];
  });
}

export function mirrorCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, explicitAxis?: StableId): SketchCommand[] {
  const inferredAxis = explicitAxis ?? (selected.length > 1 && sketch.geometry[selected.at(-1)!]?.geometry.kind === "line" ? selected.at(-1) : undefined);
  const sources = selected.filter((id) => id !== inferredAxis && id in sketch.geometry);
  if (!sources.length) return [];
  const axis = inferredAxis ? sketch.geometry[inferredAxis]?.geometry : undefined;
  const transform = axis?.kind === "line" ? (point: Point2) => reflect(point, axis.start, axis.end) : (point: Point2) => ({ x_nm: -point.x_nm, y_nm: point.y_nm });
  const bundle = transformCopies(sketch, sources, ids, transform, true);
  return [...bundle.commands, { kind: "add_operation", id: ids.next("operation"), operation: { kind: "mirror", sources, ...(inferredAxis ? { axis: inferredAxis } : {}), results: bundle.results, linked: true } }];
}

export function linearPatternCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, spacingNm: number, count = 3, options: { direction?: Point2; extent?: boolean } = {}): SketchCommand[] {
  const sources = selected.filter((id) => id in sketch.geometry); count = Math.max(1, Math.round(count)); if (!sources.length || count < 2) return [];
  const spacing = options.direction ?? { x_nm: spacingNm, y_nm: 0 }; const instances: StableId[][] = []; const commands: SketchCommand[] = [];
  for (let index = 1; index < count; index += 1) {
    const multiplier = options.extent ? index / (count - 1) : index;
    const bundle = transformCopies(sketch, sources, ids, (point) => ({ x_nm: Math.round(point.x_nm + spacing.x_nm * multiplier), y_nm: Math.round(point.y_nm + spacing.y_nm * multiplier) }));
    commands.push(...bundle.commands); instances.push(bundle.results);
  }
  commands.push({ kind: "add_operation", id: ids.next("operation"), operation: { kind: "linear_pattern", sources, instances, count, spacing, extent: Boolean(options.extent), suppressed_instances: [] } });
  return commands;
}

export function circularPatternCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, count = 4, options: { center?: Point2; angleMicrodegrees?: number } = {}): SketchCommand[] {
  const sources = selected.filter((id) => id in sketch.geometry); count = Math.max(1, Math.round(count)); if (!sources.length || count < 2) return [];
  const center = options.center ?? { x_nm: 0, y_nm: 0 }; const angleMicrodegrees = options.angleMicrodegrees ?? 360_000_000; const instances: StableId[][] = []; const commands: SketchCommand[] = [];
  const full = Math.abs(angleMicrodegrees) === 360_000_000; const divisor = full ? count : count - 1;
  for (let index = 1; index < count; index += 1) {
    const angle = angleMicrodegrees / 1_000_000 * Math.PI / 180 * index / divisor;
    const bundle = transformCopies(sketch, sources, ids, (point) => rotate(point, center, angle)); commands.push(...bundle.commands); instances.push(bundle.results);
  }
  commands.push({ kind: "add_operation", id: ids.next("operation"), operation: { kind: "circular_pattern", sources, instances, center, count, angle_microdegrees: angleMicrodegrees, suppressed_instances: [] } });
  return commands;
}

export function chamferCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, distanceNm: number): SketchCommand[] {
  const prepared = cornerPreparation(sketch, selected, distanceNm); if (!prepared) return [];
  const pair = selected.slice(-2); const result = ids.next("geometry");
  return [...prepared.moves, addLine(result, prepared.first, prepared.second), { kind: "add_operation", id: ids.next("operation"), operation: { kind: "chamfer", first: pair[0], second: pair[1], result, first_distance_nm: Math.round(distanceNm), second_distance_nm: Math.round(distanceNm), angle_microdegrees: 45_000_000, mode: "equal_distance" } }];
}

export function filletCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, radiusNm: number): SketchCommand[] {
  const pair = selected.slice(-2).map((id) => sketch.geometry[id]?.geometry);
  if (pair.some((geometry) => geometry?.kind !== "line")) return [];
  const [a, b] = pair as Array<Extract<Geometry, { kind: "line" }>>; const intersection = lineIntersection(a, b); if (!intersection) return [];
  const aFar = distance(a.start, intersection) > distance(a.end, intersection) ? a.start : a.end; const bFar = distance(b.start, intersection) > distance(b.end, intersection) ? b.start : b.end;
  const ua = unit(intersection, aFar); const ub = unit(intersection, bFar); const cosine = clamp(ua.x * ub.x + ua.y * ub.y, -0.999999, 0.999999); const half = Math.acos(cosine) / 2;
  const tangentDistance = Math.abs(radiusNm / Math.tan(half)); const first = offset(intersection, ua, tangentDistance); const second = offset(intersection, ub, tangentDistance);
  const bisector = normalize({ x: ua.x + ub.x, y: ua.y + ub.y }); const center = offset(intersection, bisector, Math.abs(radiusNm / Math.sin(half)));
  const moves = endpointMoves(selected.slice(-2), [a, b], intersection, [first, second]);
  const sourceIds = selected.slice(-2); const result = ids.next("geometry");
  return [...moves, { kind: "add_geometry", entity: { id: result, geometry: { kind: "arc", center, start: first, end: second, clockwise: cross(ua, ub) > 0 } } }, { kind: "add_operation", id: ids.next("operation"), operation: { kind: "fillet", first: sourceIds[0], second: sourceIds[1], result, radius_nm: Math.round(radiusNm) } }];
}

export function breakCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, parameters: readonly number[] = [0.5]): SketchCommand[] {
  const source = selected.at(-1); if (!source || !sketch.geometry[source]) return [];
  const cuts = [...new Set(parameters.map((value) => Math.round(value * 1_000_000)).filter((value) => value > 0 && value < 1_000_000))].sort((a, b) => a - b); if (!cuts.length) return [];
  const boundaries = [0, ...cuts, 1_000_000]; const results = boundaries.slice(0, -1).map(() => ids.next("geometry"));
  const commands = results.map((id, index) => ({ kind: "add_geometry", entity: { id, construction: sketch.geometry[source].construction, geometry: approximateCurveInterval(sketch.geometry[source].geometry, boundaries[index] / 1_000_000, boundaries[index + 1] / 1_000_000) } }) as SketchCommand);
  commands.push({ kind: "add_operation", id: ids.next("operation"), operation: { kind: "break", source, results, parameters_millionths: cuts } }); return commands;
}

export function scaleCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, factor: number, center: Point2 = { x_nm: 0, y_nm: 0 }, copy = true): SketchCommand[] {
  const sources = selected.filter((id) => id in sketch.geometry); if (!sources.length || factor <= 0) return [];
  const results = copy ? sources.map(() => ids.next("geometry")) : [...sources]; const commands: SketchCommand[] = copy ? sources.map((source, index) => ({ kind: "add_geometry", entity: { id: results[index], construction: sketch.geometry[source].construction, geometry: transformGeometry(sketch.geometry[source].geometry, (point) => scalePoint(point, center, factor), false) } })) : [];
  commands.push({ kind: "add_operation", id: ids.next("operation"), operation: { kind: "scale", sources, results, originals: sources.map((id) => structuredClone(sketch.geometry[id].geometry)), center, factor_millionths: Math.round(factor * 1_000_000), copy } }); return commands;
}

export function moveCopyCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, delta: Point2, copy = true): SketchCommand[] {
  const sources = selected.filter((id) => id in sketch.geometry); if (!sources.length || (!delta.x_nm && !delta.y_nm)) return [];
  const results = copy ? sources.map(() => ids.next("geometry")) : [...sources]; const commands: SketchCommand[] = copy ? sources.map((source, index) => ({ kind: "add_geometry", entity: { id: results[index], construction: sketch.geometry[source].construction, geometry: transformGeometry(sketch.geometry[source].geometry, (point) => ({ x_nm: point.x_nm + delta.x_nm, y_nm: point.y_nm + delta.y_nm }), false) } })) : [];
  commands.push({ kind: "add_operation", id: ids.next("operation"), operation: { kind: "move_copy", sources, results, originals: sources.map((id) => structuredClone(sketch.geometry[id].geometry)), delta, copy } }); return commands;
}

export function blendCommands(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, magnitudeNm: number, continuity: "tangent" | "g2" = "tangent"): SketchCommand[] {
  const [first, second] = selected.slice(-2); if (!first || !second || !sketch.geometry[first] || !sketch.geometry[second] || magnitudeNm <= 0) return [];
  const a = evaluateGeometryCurve(sketch.geometry[first].geometry, 1); const b = evaluateGeometryCurve(sketch.geometry[second].geometry, 0); const result = ids.next("geometry");
  return [{ kind: "add_geometry", entity: { id: result, geometry: { kind: "control_point_spline", degree: 3, control_points: [a, { x_nm: a.x_nm + magnitudeNm, y_nm: a.y_nm }, { x_nm: b.x_nm - magnitudeNm, y_nm: b.y_nm }, b], knots_millionths: [0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000] } } }, { kind: "add_operation", id: ids.next("operation"), operation: { kind: "blend", first, second, result, continuity, magnitude_nm: Math.round(magnitudeNm) } }];
}

function cornerPreparation(sketch: Sketch, selected: readonly StableId[], amount: number): { moves: SketchCommand[]; first: Point2; second: Point2 } | undefined {
  const ids = selected.slice(-2); const pair = ids.map((id) => sketch.geometry[id]?.geometry); if (pair.some((geometry) => geometry?.kind !== "line")) return undefined;
  const [a, b] = pair as Array<Extract<Geometry, { kind: "line" }>>; const intersection = lineIntersection(a, b); if (!intersection) return undefined;
  const aFar = distance(a.start, intersection) > distance(a.end, intersection) ? a.start : a.end; const bFar = distance(b.start, intersection) > distance(b.end, intersection) ? b.start : b.end;
  const first = offset(intersection, unit(intersection, aFar), amount); const second = offset(intersection, unit(intersection, bFar), amount);
  return { moves: endpointMoves(ids, [a, b], intersection, [first, second]), first, second };
}

function endpointMoves(ids: readonly StableId[], lines: Array<Extract<Geometry, { kind: "line" }>>, intersection: Point2, targets: Point2[]): SketchCommand[] {
  return lines.map((line, index) => ({ kind: "move_point", point: { geometry: ids[index], anchor: distance(line.start, intersection) < distance(line.end, intersection) ? "start" : "end" }, to: targets[index] }));
}

function transformCopies(sketch: Sketch, selected: readonly StableId[], ids: StableSketchIds, transform: (point: Point2) => Point2, reverse = false): { commands: SketchCommand[]; results: StableId[] } {
  const commands: SketchCommand[] = []; const results: StableId[] = [];
  for (const id of selected) { const source = sketch.geometry[id]; if (!source) continue; const result = ids.next("geometry"); results.push(result); commands.push({ kind: "add_geometry", entity: { id: result, construction: source.construction, geometry: transformGeometry(source.geometry, transform, reverse) } }); }
  return { commands, results };
}

function transformGeometry(geometry: Geometry, transform: (point: Point2) => Point2, reverse: boolean): Geometry {
  if (geometry.kind === "line") return { kind: "line", start: transform(geometry.start), end: transform(geometry.end) };
  if (geometry.kind === "circle") return { ...geometry, center: transform(geometry.center) };
  if (geometry.kind === "arc") return { ...geometry, center: transform(geometry.center), start: transform(geometry.start), end: transform(geometry.end), clockwise: reverse ? !geometry.clockwise : geometry.clockwise };
  if (geometry.kind === "control_point_spline") return { ...geometry, control_points: geometry.control_points.map(transform) };
  if (geometry.kind === "fit_point_spline") return { ...geometry, fit_points: geometry.fit_points.map(transform) };
  if (geometry.kind === "ellipse") return { ...geometry, center: transform(geometry.center), major: transform(geometry.major), minor: transform(geometry.minor) };
  if (geometry.kind === "elliptical_arc") return { ...geometry, center: transform(geometry.center), major: transform(geometry.major), minor: transform(geometry.minor), start: transform(geometry.start), end: transform(geometry.end) };
  if (geometry.kind === "conic") return { ...geometry, start: transform(geometry.start), control: transform(geometry.control), end: transform(geometry.end) };
  if (geometry.kind === "sketch_point") return { kind: "sketch_point", ...transform({ x_nm: geometry.x_nm, y_nm: geometry.y_nm }) };
  const a = transform(geometry.min); const b = transform(geometry.max); return { kind: "rectangle", min: { x_nm: Math.min(a.x_nm, b.x_nm), y_nm: Math.min(a.y_nm, b.y_nm) }, max: { x_nm: Math.max(a.x_nm, b.x_nm), y_nm: Math.max(a.y_nm, b.y_nm) } };
}

function polylineCommands(ids: StableSketchIds, points: readonly Point2[], close: boolean): SketchCommand[] {
  const count = close ? points.length : points.length - 1; const lineIds = Array.from({ length: count }, () => ids.next("geometry")); const commands: SketchCommand[] = [];
  for (let index = 0; index < count; index += 1) commands.push(addLine(lineIds[index], points[index], points[(index + 1) % points.length]));
  for (let index = 0; index < count - (close ? 0 : 1); index += 1) commands.push({ kind: "add_constraint", id: ids.next("constraint"), constraint: { kind: "coincident", a: { geometry: lineIds[index], anchor: "end" }, b: { geometry: lineIds[(index + 1) % count], anchor: "start" } } });
  return commands;
}

function reflect(point: Point2, start: Point2, end: Point2): Point2 {
  const dx = end.x_nm - start.x_nm; const dy = end.y_nm - start.y_nm; const denominator = dx * dx + dy * dy || 1;
  const parameter = ((point.x_nm - start.x_nm) * dx + (point.y_nm - start.y_nm) * dy) / denominator;
  const projection = { x_nm: start.x_nm + dx * parameter, y_nm: start.y_nm + dy * parameter };
  return { x_nm: Math.round(2 * projection.x_nm - point.x_nm), y_nm: Math.round(2 * projection.y_nm - point.y_nm) };
}

function rotate(point: Point2, center: Point2, angle: number): Point2 {
  const x = point.x_nm - center.x_nm; const y = point.y_nm - center.y_nm;
  return { x_nm: Math.round(center.x_nm + x * Math.cos(angle) - y * Math.sin(angle)), y_nm: Math.round(center.y_nm + x * Math.sin(angle) + y * Math.cos(angle)) };
}

function scalePoint(point: Point2, center: Point2, factor: number): Point2 {
  return { x_nm: Math.round(center.x_nm + (point.x_nm - center.x_nm) * factor), y_nm: Math.round(center.y_nm + (point.y_nm - center.y_nm) * factor) };
}

function approximateCurveInterval(geometry: Geometry, start: number, end: number): Geometry {
  if (geometry.kind === "line") return { kind: "line", start: evaluateGeometryCurve(geometry, start), end: evaluateGeometryCurve(geometry, end) };
  if (geometry.kind === "arc") return { ...geometry, start: evaluateGeometryCurve(geometry, start), end: evaluateGeometryCurve(geometry, end) };
  if (geometry.kind === "circle") return { kind: "arc", center: geometry.center, start: evaluateGeometryCurve(geometry, start), end: evaluateGeometryCurve(geometry, end), clockwise: false };
  const controls = [0, 1 / 3, 2 / 3, 1].map((value) => evaluateGeometryCurve(geometry, start + (end - start) * value));
  return { kind: "control_point_spline", degree: 3, control_points: controls, knots_millionths: [0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000] };
}

function addLine(id: StableId, start: Point2, end: Point2): SketchCommand { return { kind: "add_geometry", entity: { id, geometry: { kind: "line", start, end } } }; }
function distance(a: Point2, b: Point2): number { return Math.hypot(b.x_nm - a.x_nm, b.y_nm - a.y_nm); }
function unit(a: Point2, b: Point2): { x: number; y: number } { const d = distance(a, b) || 1; return { x: (b.x_nm - a.x_nm) / d, y: (b.y_nm - a.y_nm) / d }; }
function normalize(a: { x: number; y: number }): { x: number; y: number } { const d = Math.hypot(a.x, a.y) || 1; return { x: a.x / d, y: a.y / d }; }
function offset(point: Point2, direction: { x: number; y: number }, amount: number): Point2 { return { x_nm: Math.round(point.x_nm + direction.x * amount), y_nm: Math.round(point.y_nm + direction.y * amount) }; }
function radial(center: Point2, point: Point2, radius: number): Point2 { return offset(center, unit(center, point), radius); }
function pointOnCircle(center: Point2, radius: number, angle: number): Point2 { return { x_nm: Math.round(center.x_nm + Math.cos(angle) * radius), y_nm: Math.round(center.y_nm + Math.sin(angle) * radius) }; }
function cross(a: { x: number; y: number }, b: { x: number; y: number }): number { return a.x * b.y - a.y * b.x; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function lineIntersection(a: Extract<Geometry, { kind: "line" }>, b: Extract<Geometry, { kind: "line" }>): Point2 | undefined {
  const ax = a.end.x_nm - a.start.x_nm; const ay = a.end.y_nm - a.start.y_nm; const bx = b.end.x_nm - b.start.x_nm; const by = b.end.y_nm - b.start.y_nm; const denominator = cross({ x: ax, y: ay }, { x: bx, y: by }); if (Math.abs(denominator) < 1e-9) return undefined;
  const dx = b.start.x_nm - a.start.x_nm; const dy = b.start.y_nm - a.start.y_nm; const t = cross({ x: dx, y: dy }, { x: bx, y: by }) / denominator;
  return { x_nm: Math.round(a.start.x_nm + ax * t), y_nm: Math.round(a.start.y_nm + ay * t) };
}
