import type { Geometry, GeometryEntity, Point2, Sketch, StableId } from "./sketch-editor.ts";

/** Plane-space axis-aligned bounds in the sketch's native nanometer units. */
export type SketchSnapBounds = {
  min: Point2;
  max: Point2;
};

export type SketchSnapSpatialIndexOptions = {
  /**
   * Extra safety margin applied to every finite geometry bound. The query
   * aperture is applied separately, so this is normally just a rounding
   * guard rather than the screen-space snap tolerance.
   */
  boundsPaddingNm?: number;
  /** Maximum entries in a terminal BVH node. */
  leafSize?: number;
};

type IndexedGeometry = {
  entity: GeometryEntity;
  bounds: SketchSnapBounds;
  ordinal: number;
};

type IndexedLineDirection = { entity: GeometryEntity; x: number; y: number; angle: number; length: number; ordinal: number };

type SpatialNode = {
  bounds: SketchSnapBounds;
  entries?: IndexedGeometry[];
  first?: SpatialNode;
  second?: SpatialNode;
};

const DEFAULT_BOUNDS_PADDING_NM = 1;
const DEFAULT_LEAF_SIZE = 8;

/**
 * Returns a conservative bound containing both the evaluated geometry and
 * its durable snap handles. Undefined means the geometry cannot be bounded
 * safely (for example, a singular rational conic); such geometry is retained
 * as an always-query candidate by SketchSnapSpatialIndex.
 */
export function sketchGeometrySnapBounds(geometry: Geometry, paddingNm = DEFAULT_BOUNDS_PADDING_NM): SketchSnapBounds | undefined {
  const padding = normalizedNonNegative(paddingNm, "paddingNm");
  let bounds: SketchSnapBounds | undefined;

  if (geometry.kind === "line") {
    bounds = pointsBounds([geometry.start, geometry.end]);
  } else if (geometry.kind === "circle") {
    const radius = Math.abs(geometry.radius_nm);
    bounds = finitePoint(geometry.center) && Number.isFinite(radius)
      ? {
          min: { x_nm: geometry.center.x_nm - radius, y_nm: geometry.center.y_nm - radius },
          max: { x_nm: geometry.center.x_nm + radius, y_nm: geometry.center.y_nm + radius },
        }
      : undefined;
  } else if (geometry.kind === "arc") {
    if (finitePoint(geometry.center) && finitePoint(geometry.start) && finitePoint(geometry.end)) {
      const radius = Math.hypot(geometry.start.x_nm - geometry.center.x_nm, geometry.start.y_nm - geometry.center.y_nm);
      bounds = Number.isFinite(radius)
        ? unionBounds(
            {
              min: { x_nm: geometry.center.x_nm - radius, y_nm: geometry.center.y_nm - radius },
              max: { x_nm: geometry.center.x_nm + radius, y_nm: geometry.center.y_nm + radius },
            },
            pointsBounds([geometry.center, geometry.start, geometry.end])!,
          )
        : undefined;
    }
  } else if (geometry.kind === "rectangle") {
    bounds = pointsBounds([geometry.min, geometry.max]);
  } else if (geometry.kind === "control_point_spline") {
    // A non-rational B-spline lies in the convex hull of its control points.
    bounds = pointsBounds(geometry.control_points);
  } else if (geometry.kind === "fit_point_spline") {
    bounds = fitPointSplineBounds(geometry.fit_points);
  } else if (geometry.kind === "ellipse" || geometry.kind === "elliptical_arc") {
    bounds = ellipseBounds(geometry.center, geometry.major, geometry.minor);
    if (bounds && geometry.kind === "elliptical_arc") {
      const handles = pointsBounds([geometry.start, geometry.end]);
      if (!handles) return undefined;
      bounds = unionBounds(bounds, handles);
    }
  } else if (geometry.kind === "conic") {
    // Positive rational Bernstein weights preserve the convex-hull property.
    // A negative weight can make the denominator singular, so it is kept in
    // the index's always-query set instead of risking a false negative.
    bounds = Number.isFinite(geometry.weight_millionths) && geometry.weight_millionths >= 0
      ? pointsBounds([geometry.start, geometry.control, geometry.end])
      : undefined;
  } else {
    bounds = pointsBounds([{ x_nm: geometry.x_nm, y_nm: geometry.y_nm }]);
  }

  // Geometry evaluation rounds to integral nanometers. Enclose before adding
  // optional padding so even a zero-padding index cannot exclude that rounded
  // result at a fractional analytic extremum.
  return bounds && finiteBounds(bounds) ? expandBounds(encloseBounds(bounds), padding) : undefined;
}

/**
 * Immutable, revision-scoped broad-phase index for sketch snapping.
 *
 * queryNearby() intentionally performs only an AABB broad-phase. Consumers
 * must still run their existing anchor-distance and exact curve-projection
 * checks before accepting a snap.
 */
export class SketchSnapSpatialIndex {
  readonly sketchId: StableId;
  readonly revision: number;
  readonly geometryIdentity: Sketch["geometry"];
  readonly boundsPaddingNm: number;
  readonly size: number;

  readonly #root: SpatialNode | undefined;
  readonly #alwaysCandidates: IndexedGeometry[];
  readonly #linesByAngle: IndexedLineDirection[];
  readonly #linesByLength: IndexedLineDirection[];

  constructor(sketch: Sketch, options: SketchSnapSpatialIndexOptions = {}) {
    this.sketchId = sketch.id;
    this.revision = sketch.revision;
    this.geometryIdentity = sketch.geometry;
    this.boundsPaddingNm = normalizedNonNegative(options.boundsPaddingNm ?? DEFAULT_BOUNDS_PADDING_NM, "boundsPaddingNm");
    const leafSize = normalizedPositiveInteger(options.leafSize ?? DEFAULT_LEAF_SIZE, "leafSize");
    const bounded: IndexedGeometry[] = [];
    const alwaysCandidates: IndexedGeometry[] = [];
    const lines: IndexedLineDirection[] = [];
    Object.values(sketch.geometry).forEach((entity, ordinal) => {
      const bounds = sketchGeometrySnapBounds(entity.geometry, this.boundsPaddingNm);
      const entry = { entity, bounds: bounds ?? zeroBounds(), ordinal };
      if (bounds) bounded.push(entry);
      else alwaysCandidates.push(entry);
      if (entity.geometry.kind === "line") {
        const dx = entity.geometry.end.x_nm - entity.geometry.start.x_nm;
        const dy = entity.geometry.end.y_nm - entity.geometry.start.y_nm;
        const length = Math.hypot(dx, dy);
        if (Number.isFinite(length) && length > 0) {
          const x = dx / length; const y = dy / length;
          const angle = ((Math.atan2(y, x) % Math.PI) + Math.PI) % Math.PI;
          lines.push({ entity, x, y, angle, length, ordinal });
        }
      }
    });
    this.size = bounded.length + alwaysCandidates.length;
    this.#root = buildNode(bounded, leafSize);
    this.#alwaysCandidates = alwaysCandidates;
    this.#linesByAngle = [...lines].sort((left, right) => left.angle - right.angle || left.ordinal - right.ordinal);
    this.#linesByLength = [...lines].sort((left, right) => left.length - right.length || left.ordinal - right.ordinal);
  }

  /** True only for the exact sketch revision and geometry record indexed. */
  matches(sketch: Sketch): boolean {
    return sketch.id === this.sketchId
      && sketch.revision === this.revision
      && sketch.geometry === this.geometryIdentity;
  }

  /**
   * Returns broad-phase candidates whose conservative bounds intersect a
   * square aperture around point. Results retain sketch geometry order.
   */
  queryNearby(point: Point2, toleranceNm: number): readonly GeometryEntity[] {
    if (!finitePoint(point)) return [];
    const tolerance = normalizedNonNegative(toleranceNm, "toleranceNm");
    const queryBounds: SketchSnapBounds = {
      min: { x_nm: point.x_nm - tolerance, y_nm: point.y_nm - tolerance },
      max: { x_nm: point.x_nm + tolerance, y_nm: point.y_nm + tolerance },
    };
    const matches = [...this.#alwaysCandidates];
    queryNode(this.#root, queryBounds, matches);
    matches.sort((left, right) => left.ordinal - right.ordinal);
    return matches.map(({ entity }) => entity);
  }

  queryNearbyIds(point: Point2, toleranceNm: number): readonly StableId[] {
    return this.queryNearby(point, toleranceNm).map(({ id }) => id);
  }

  /**
   * Broad-phase for global line-direction inference. It retains only lines
   * capable of satisfying parallel, perpendicular, or equal-length intent;
   * the consumer still performs the existing exact scoring and priority rules.
   */
  queryDirectionalLines(direction: { x: number; y: number }, lengthNm: number, angularTolerance: number, lengthToleranceNm: number): readonly GeometryEntity[] {
    if (![direction.x, direction.y, lengthNm, angularTolerance, lengthToleranceNm].every(Number.isFinite)) return [];
    const angular = normalizedNonNegative(angularTolerance, "angularTolerance");
    const lengthTolerance = normalizedNonNegative(lengthToleranceNm, "lengthToleranceNm");
    const magnitude = Math.hypot(direction.x, direction.y);
    if (!(magnitude > 0)) return [];
    const unit = { x: direction.x / magnitude, y: direction.y / magnitude };
    const baseAngle = ((Math.atan2(unit.y, unit.x) % Math.PI) + Math.PI) % Math.PI;
    const angleWindow = Math.asin(Math.min(1, angular));
    const candidates = new Map<number, IndexedLineDirection>();
    for (const target of [baseAngle, (baseAngle + Math.PI / 2) % Math.PI]) {
      for (const line of cyclicAngleRange(this.#linesByAngle, target, angleWindow)) candidates.set(line.ordinal, line);
    }
    for (const line of numericRange(this.#linesByLength, lengthNm - lengthTolerance, lengthNm + lengthTolerance, (entry) => entry.length)) candidates.set(line.ordinal, line);
    return [...candidates.values()]
      .filter((line) => {
        const parallelError = Math.abs(unit.x * line.y - unit.y * line.x);
        const perpendicularError = Math.abs(unit.x * line.x + unit.y * line.y);
        return parallelError <= angular || perpendicularError <= angular || Math.abs(lengthNm - line.length) <= lengthTolerance;
      })
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(({ entity }) => entity);
  }
}

function numericRange<T>(values: readonly T[], minimum: number, maximum: number, select: (value: T) => number): readonly T[] {
  const lowerBound = (target: number) => {
    let low = 0; let high = values.length;
    while (low < high) { const middle = (low + high) >>> 1; if (select(values[middle]) < target) low = middle + 1; else high = middle; }
    return low;
  };
  return values.slice(lowerBound(minimum), lowerBound(maximum + Number.EPSILON));
}

function cyclicAngleRange<T>(values: readonly T[], target: number, radius: number, select: (value: T) => number = (value) => (value as { angle: number }).angle): readonly T[] {
  if (radius >= Math.PI / 2) return values;
  const minimum = target - radius; const maximum = target + radius;
  if (minimum >= 0 && maximum < Math.PI) return numericRange(values, minimum, maximum, select);
  if (minimum < 0) return [...numericRange(values, 0, maximum, select), ...numericRange(values, Math.PI + minimum, Math.PI, select)];
  return [...numericRange(values, minimum, Math.PI, select), ...numericRange(values, 0, maximum - Math.PI, select)];
}

/**
 * Small owner-side cache. A changed revision or a replaced geometry record
 * always rebuilds; unrelated Sketch object wrappers reuse the existing index.
 */
export class SketchSnapSpatialIndexCache {
  #index: SketchSnapSpatialIndex | undefined;
  readonly #options: SketchSnapSpatialIndexOptions;

  constructor(options: SketchSnapSpatialIndexOptions = {}) {
    this.#options = { ...options };
  }

  forSketch(sketch: Sketch): SketchSnapSpatialIndex {
    if (!this.#index?.matches(sketch)) this.#index = new SketchSnapSpatialIndex(sketch, this.#options);
    return this.#index;
  }

  clear(): void {
    this.#index = undefined;
  }
}

function fitPointSplineBounds(points: readonly Point2[]): SketchSnapBounds | undefined {
  if (!points.length || points.some((point) => !finitePoint(point))) return undefined;
  if (points.length === 1) return pointsBounds(points);
  let bounds: SketchSnapBounds | undefined;
  for (let segment = 0; segment + 1 < points.length; segment += 1) {
    const p0 = points[Math.max(0, segment - 1)];
    const p1 = points[segment];
    const p2 = points[segment + 1];
    const p3 = points[Math.min(points.length - 1, segment + 2)];
    const axisBounds = (axis: keyof Point2): [number, number] => {
      const c1 = -p0[axis] + p2[axis];
      const c2 = 2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis];
      const c3 = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
      const excursion = 0.5 * (Math.abs(c1) + Math.abs(c2) + Math.abs(c3));
      return [p1[axis] - excursion, p1[axis] + excursion];
    };
    const [minX, maxX] = axisBounds("x_nm");
    const [minY, maxY] = axisBounds("y_nm");
    const segmentBounds = { min: { x_nm: minX, y_nm: minY }, max: { x_nm: maxX, y_nm: maxY } };
    bounds = bounds ? unionBounds(bounds, segmentBounds) : segmentBounds;
  }
  return bounds;
}

function ellipseBounds(center: Point2, major: Point2, minor: Point2): SketchSnapBounds | undefined {
  if (![center, major, minor].every(finitePoint)) return undefined;
  const xRadius = Math.hypot(major.x_nm - center.x_nm, minor.x_nm - center.x_nm);
  const yRadius = Math.hypot(major.y_nm - center.y_nm, minor.y_nm - center.y_nm);
  if (!Number.isFinite(xRadius) || !Number.isFinite(yRadius)) return undefined;
  return {
    min: { x_nm: Math.floor(center.x_nm - xRadius), y_nm: Math.floor(center.y_nm - yRadius) },
    max: { x_nm: Math.ceil(center.x_nm + xRadius), y_nm: Math.ceil(center.y_nm + yRadius) },
  };
}

function pointsBounds(points: readonly Point2[]): SketchSnapBounds | undefined {
  if (!points.length || points.some((point) => !finitePoint(point))) return undefined;
  const bounds = { min: { ...points[0] }, max: { ...points[0] } };
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    bounds.min.x_nm = Math.min(bounds.min.x_nm, point.x_nm);
    bounds.min.y_nm = Math.min(bounds.min.y_nm, point.y_nm);
    bounds.max.x_nm = Math.max(bounds.max.x_nm, point.x_nm);
    bounds.max.y_nm = Math.max(bounds.max.y_nm, point.y_nm);
  }
  return bounds;
}

function buildNode(entries: IndexedGeometry[], leafSize: number): SpatialNode | undefined {
  if (!entries.length) return undefined;
  const bounds = entries.slice(1).reduce((value, entry) => unionBounds(value, entry.bounds), entries[0].bounds);
  if (entries.length <= leafSize) return { bounds, entries };
  const width = bounds.max.x_nm - bounds.min.x_nm;
  const height = bounds.max.y_nm - bounds.min.y_nm;
  const axis: keyof Point2 = width >= height ? "x_nm" : "y_nm";
  entries.sort((left, right) => boundsCenter(left.bounds, axis) - boundsCenter(right.bounds, axis) || left.ordinal - right.ordinal);
  const middle = Math.floor(entries.length / 2);
  return {
    bounds,
    first: buildNode(entries.slice(0, middle), leafSize),
    second: buildNode(entries.slice(middle), leafSize),
  };
}

function queryNode(node: SpatialNode | undefined, query: SketchSnapBounds, output: IndexedGeometry[]): void {
  if (!node || !boundsIntersect(node.bounds, query)) return;
  if (node.entries) {
    for (const entry of node.entries) if (boundsIntersect(entry.bounds, query)) output.push(entry);
    return;
  }
  queryNode(node.first, query, output);
  queryNode(node.second, query, output);
}

function boundsCenter(bounds: SketchSnapBounds, axis: keyof Point2): number {
  return bounds.min[axis] + (bounds.max[axis] - bounds.min[axis]) / 2;
}

function boundsIntersect(first: SketchSnapBounds, second: SketchSnapBounds): boolean {
  return first.min.x_nm <= second.max.x_nm
    && first.max.x_nm >= second.min.x_nm
    && first.min.y_nm <= second.max.y_nm
    && first.max.y_nm >= second.min.y_nm;
}

function unionBounds(first: SketchSnapBounds, second: SketchSnapBounds): SketchSnapBounds {
  return {
    min: { x_nm: Math.min(first.min.x_nm, second.min.x_nm), y_nm: Math.min(first.min.y_nm, second.min.y_nm) },
    max: { x_nm: Math.max(first.max.x_nm, second.max.x_nm), y_nm: Math.max(first.max.y_nm, second.max.y_nm) },
  };
}

function expandBounds(bounds: SketchSnapBounds, amount: number): SketchSnapBounds {
  return {
    min: { x_nm: bounds.min.x_nm - amount, y_nm: bounds.min.y_nm - amount },
    max: { x_nm: bounds.max.x_nm + amount, y_nm: bounds.max.y_nm + amount },
  };
}

function encloseBounds(bounds: SketchSnapBounds): SketchSnapBounds {
  return {
    min: { x_nm: Math.floor(bounds.min.x_nm), y_nm: Math.floor(bounds.min.y_nm) },
    max: { x_nm: Math.ceil(bounds.max.x_nm), y_nm: Math.ceil(bounds.max.y_nm) },
  };
}

function finitePoint(point: Point2): boolean {
  return Number.isFinite(point.x_nm) && Number.isFinite(point.y_nm);
}

function finiteBounds(bounds: SketchSnapBounds): boolean {
  return finitePoint(bounds.min)
    && finitePoint(bounds.max)
    && bounds.min.x_nm <= bounds.max.x_nm
    && bounds.min.y_nm <= bounds.max.y_nm;
}

function normalizedNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite non-negative number`);
  return value;
}

function normalizedPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function zeroBounds(): SketchSnapBounds {
  return { min: { x_nm: 0, y_nm: 0 }, max: { x_nm: 0, y_nm: 0 } };
}
