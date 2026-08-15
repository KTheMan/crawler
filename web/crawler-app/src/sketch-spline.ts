import type { Geometry, Point2 } from "./sketch-editor";

/** Deterministic Bézier evaluation used only for display and hit testing. */
export function evaluateControlPointSpline(controlPoints: readonly Point2[], t: number, requestedDegree = 3, knotsMillionths?: readonly number[]): Point2 {
  if (controlPoints.length === 0) return { x_nm: 0, y_nm: 0 };
  const degree = Math.max(0, Math.min(requestedDegree, controlPoints.length - 1));
  const clamped = Math.max(0, Math.min(1, t));
  if (degree === 0) return controlPoints[Math.round(clamped * (controlPoints.length - 1))];
  const spans = Math.max(1, controlPoints.length - degree);
  const knots = knotsMillionths?.length === controlPoints.length + degree + 1
    ? knotsMillionths.map((value) => value / 1_000_000)
    : Array.from({ length: controlPoints.length + degree + 1 }, (_, index) => index <= degree ? 0 : index >= controlPoints.length ? 1 : (index - degree) / spans);
  const span = clamped >= 1 ? controlPoints.length - 1 : Array.from({ length: controlPoints.length - degree }, (_, index) => index + degree).find((index) => clamped < knots[index + 1]) ?? controlPoints.length - 1;
  const work = Array.from({ length: degree + 1 }, (_, index) => ({ ...controlPoints[span - degree + index] }));
  for (let level = 1; level <= degree; level += 1) {
    for (let index = degree; index >= level; index -= 1) {
      const knotIndex = span - degree + index;
      const denominator = knots[knotIndex + degree - level + 1] - knots[knotIndex];
      const alpha = denominator ? (clamped - knots[knotIndex]) / denominator : 0;
      work[index] = {
        x_nm: (1 - alpha) * work[index - 1].x_nm + alpha * work[index].x_nm,
        y_nm: (1 - alpha) * work[index - 1].y_nm + alpha * work[index].y_nm,
      };
    }
  }
  return { x_nm: Math.round(work[degree].x_nm), y_nm: Math.round(work[degree].y_nm) };
}

export function sampleControlPointSpline(controlPoints: readonly Point2[], count = 48, degree = 3, knotsMillionths?: readonly number[]): Point2[] {
  if (controlPoints.length < 2) return [...controlPoints];
  return Array.from({ length: count + 1 }, (_, index) =>
    evaluateControlPointSpline(controlPoints, index / count, degree, knotsMillionths));
}

export function evaluateFitPointSpline(points: readonly Point2[], t: number): Point2 {
  if (points.length < 2) return points[0] ?? { x_nm: 0, y_nm: 0 };
  const scaled = Math.max(0, Math.min(1, t)) * (points.length - 1);
  const segment = Math.min(points.length - 2, Math.floor(scaled));
  const u = t >= 1 ? 1 : scaled - segment;
  const p0 = points[Math.max(0, segment - 1)]; const p1 = points[segment];
  const p2 = points[segment + 1]; const p3 = points[Math.min(points.length - 1, segment + 2)];
  const value = (a: number, b: number, c: number, d: number) => Math.round(0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u ** 2 + (-a + 3 * b - 3 * c + d) * u ** 3));
  return { x_nm: value(p0.x_nm, p1.x_nm, p2.x_nm, p3.x_nm), y_nm: value(p0.y_nm, p1.y_nm, p2.y_nm, p3.y_nm) };
}

export function sampleFitPointSpline(points: readonly Point2[], count = 48): Point2[] {
  return points.length < 2 ? [...points] : Array.from({ length: count + 1 }, (_, index) => evaluateFitPointSpline(points, index / count));
}

export function evaluateEllipse(center: Point2, major: Point2, minor: Point2, t: number): Point2 {
  const angle = Math.max(0, Math.min(1, t)) * Math.PI * 2;
  return {
    x_nm: Math.round(center.x_nm + (major.x_nm - center.x_nm) * Math.cos(angle) + (minor.x_nm - center.x_nm) * Math.sin(angle)),
    y_nm: Math.round(center.y_nm + (major.y_nm - center.y_nm) * Math.cos(angle) + (minor.y_nm - center.y_nm) * Math.sin(angle)),
  };
}

export function sampleEllipse(center: Point2, major: Point2, minor: Point2, count = 64): Point2[] {
  return Array.from({ length: count + 1 }, (_, index) => evaluateEllipse(center, major, minor, index / count));
}

export function ellipseParameter(center: Point2, major: Point2, minor: Point2, point: Point2): number {
  const ax = major.x_nm - center.x_nm; const ay = major.y_nm - center.y_nm;
  const bx = minor.x_nm - center.x_nm; const by = minor.y_nm - center.y_nm;
  const px = point.x_nm - center.x_nm; const py = point.y_nm - center.y_nm;
  const determinant = ax * by - ay * bx;
  if (!determinant) return 0;
  const cosine = (px * by - py * bx) / determinant;
  const sine = (ax * py - ay * px) / determinant;
  return Math.atan2(sine, cosine);
}

export function projectPointToEllipse(center: Point2, major: Point2, minor: Point2, point: Point2): Point2 {
  const parameter = ellipseParameter(center, major, minor, point);
  return evaluateEllipse(center, major, minor, parameter / (Math.PI * 2));
}

export function sampleEllipticalArc(center: Point2, major: Point2, minor: Point2, start: Point2, end: Point2, clockwise: boolean, count = 48): Point2[] {
  let startAngle = ellipseParameter(center, major, minor, start);
  let endAngle = ellipseParameter(center, major, minor, end);
  if (clockwise) {
    while (endAngle >= startAngle) endAngle -= Math.PI * 2;
  } else {
    while (endAngle <= startAngle) endAngle += Math.PI * 2;
  }
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = startAngle + (endAngle - startAngle) * (index / count);
    return evaluateEllipse(center, major, minor, angle / (Math.PI * 2));
  });
}

export function evaluateConic(start: Point2, control: Point2, end: Point2, weightMillionths: number, t: number): Point2 {
  const u = Math.max(0, Math.min(1, t)); const inverse = 1 - u; const weight = weightMillionths / 1_000_000;
  const a = inverse ** 2; const b = 2 * weight * inverse * u; const c = u ** 2; const denominator = a + b + c;
  return {
    x_nm: Math.round((a * start.x_nm + b * control.x_nm + c * end.x_nm) / denominator),
    y_nm: Math.round((a * start.y_nm + b * control.y_nm + c * end.y_nm) / denominator),
  };
}

export function sampleConic(start: Point2, control: Point2, end: Point2, weightMillionths: number, count = 48): Point2[] {
  return Array.from({ length: count + 1 }, (_, index) => evaluateConic(start, control, end, weightMillionths, index / count));
}

export type CurveFrame = { point: Point2; tangent: { x: number; y: number }; curvature_per_nm: number };
export type CurveProjection = CurveFrame & { parameter: number; distance_nm: number; error_bound_nm: number };
export type CurveIntersection = { point: Point2; first_parameter: number; second_parameter: number };
export type CurveBounds = { min: Point2; max: Point2 };

/** Canonical parameter evaluation shared by hit-testing, modifiers, inferencing, and dimensions. */
export function evaluateGeometryCurve(geometry: Geometry, parameter: number): Point2 {
  const t = Math.max(0, Math.min(1, parameter));
  if (geometry.kind === "line") return {
    x_nm: Math.round(geometry.start.x_nm + (geometry.end.x_nm - geometry.start.x_nm) * t),
    y_nm: Math.round(geometry.start.y_nm + (geometry.end.y_nm - geometry.start.y_nm) * t),
  };
  if (geometry.kind === "circle") {
    const angle = t * Math.PI * 2;
    return { x_nm: Math.round(geometry.center.x_nm + Math.cos(angle) * geometry.radius_nm), y_nm: Math.round(geometry.center.y_nm + Math.sin(angle) * geometry.radius_nm) };
  }
  if (geometry.kind === "arc") {
    const start = Math.atan2(geometry.start.y_nm - geometry.center.y_nm, geometry.start.x_nm - geometry.center.x_nm);
    let end = Math.atan2(geometry.end.y_nm - geometry.center.y_nm, geometry.end.x_nm - geometry.center.x_nm);
    if (geometry.clockwise) while (end >= start) end -= Math.PI * 2; else while (end <= start) end += Math.PI * 2;
    const radius = Math.hypot(geometry.start.x_nm - geometry.center.x_nm, geometry.start.y_nm - geometry.center.y_nm);
    const angle = start + (end - start) * t;
    return { x_nm: Math.round(geometry.center.x_nm + Math.cos(angle) * radius), y_nm: Math.round(geometry.center.y_nm + Math.sin(angle) * radius) };
  }
  if (geometry.kind === "control_point_spline") return evaluateControlPointSpline(geometry.control_points, t, geometry.degree, geometry.knots_millionths);
  if (geometry.kind === "fit_point_spline") return evaluateFitPointSpline(geometry.fit_points, t);
  if (geometry.kind === "ellipse") return evaluateEllipse(geometry.center, geometry.major, geometry.minor, t);
  if (geometry.kind === "elliptical_arc") {
    let start = ellipseParameter(geometry.center, geometry.major, geometry.minor, geometry.start);
    let end = ellipseParameter(geometry.center, geometry.major, geometry.minor, geometry.end);
    if (geometry.clockwise) while (end >= start) end -= Math.PI * 2; else while (end <= start) end += Math.PI * 2;
    const angle = start + (end - start) * t;
    return evaluateEllipse(geometry.center, geometry.major, geometry.minor, ((angle / (Math.PI * 2)) % 1 + 1) % 1);
  }
  if (geometry.kind === "conic") return evaluateConic(geometry.start, geometry.control, geometry.end, geometry.weight_millionths, t);
  if (geometry.kind === "sketch_point") return { x_nm: geometry.x_nm, y_nm: geometry.y_nm };
  const corners = [geometry.min, { x_nm: geometry.max.x_nm, y_nm: geometry.min.y_nm }, geometry.max, { x_nm: geometry.min.x_nm, y_nm: geometry.max.y_nm }, geometry.min];
  const scaled = t * 4; const index = Math.min(3, Math.floor(scaled)); const u = scaled >= 4 ? 1 : scaled - index;
  return { x_nm: Math.round(corners[index].x_nm + (corners[index + 1].x_nm - corners[index].x_nm) * u), y_nm: Math.round(corners[index].y_nm + (corners[index + 1].y_nm - corners[index].y_nm) * u) };
}

export function evaluateCurveFrame(geometry: Geometry, parameter: number): CurveFrame {
  const t = Math.max(0, Math.min(1, parameter));
  const scale = geometry.kind === "circle" ? geometry.radius_nm * 2
    : geometry.kind === "arc" ? Math.hypot(geometry.start.x_nm - geometry.center.x_nm, geometry.start.y_nm - geometry.center.y_nm) * 2
      : geometry.kind === "line" ? Math.hypot(geometry.end.x_nm - geometry.start.x_nm, geometry.end.y_nm - geometry.start.y_nm)
        : geometry.kind === "control_point_spline" ? Math.hypot(Math.max(...geometry.control_points.map((point) => point.x_nm)) - Math.min(...geometry.control_points.map((point) => point.x_nm)), Math.max(...geometry.control_points.map((point) => point.y_nm)) - Math.min(...geometry.control_points.map((point) => point.y_nm)))
          : geometry.kind === "fit_point_spline" ? Math.hypot(Math.max(...geometry.fit_points.map((point) => point.x_nm)) - Math.min(...geometry.fit_points.map((point) => point.x_nm)), Math.max(...geometry.fit_points.map((point) => point.y_nm)) - Math.min(...geometry.fit_points.map((point) => point.y_nm)))
            : geometry.kind === "ellipse" || geometry.kind === "elliptical_arc" ? Math.max(Math.hypot(geometry.major.x_nm - geometry.center.x_nm, geometry.major.y_nm - geometry.center.y_nm), Math.hypot(geometry.minor.x_nm - geometry.center.x_nm, geometry.minor.y_nm - geometry.center.y_nm)) * 2
              : geometry.kind === "conic" ? Math.hypot(Math.max(geometry.start.x_nm, geometry.control.x_nm, geometry.end.x_nm) - Math.min(geometry.start.x_nm, geometry.control.x_nm, geometry.end.x_nm), Math.max(geometry.start.y_nm, geometry.control.y_nm, geometry.end.y_nm) - Math.min(geometry.start.y_nm, geometry.control.y_nm, geometry.end.y_nm))
                : 1;
  const h = scale >= 100_000 ? 1e-4 : 1 / 32;
  const left = evaluateGeometryCurve(geometry, Math.max(0, t - h));
  const point = evaluateGeometryCurve(geometry, t);
  const right = evaluateGeometryCurve(geometry, Math.min(1, t + h));
  const dx = right.x_nm - left.x_nm; const dy = right.y_nm - left.y_nm; const magnitude = Math.hypot(dx, dy) || 1;
  const ddx = right.x_nm - 2 * point.x_nm + left.x_nm; const ddy = right.y_nm - 2 * point.y_nm + left.y_nm;
  return { point, tangent: { x: dx / magnitude, y: dy / magnitude }, curvature_per_nm: (dx * ddy - dy * ddx) / Math.max(1, magnitude ** 3) };
}

type ParameterInterval = { start: number; end: number; bounds: CurveBounds; depth: number };
type CertifiedChord = { start: number; end: number; a: Point2; b: Point2; error_bound_nm: number };

/** Globally bounded projection using conservative derivative interval boxes. */
export function projectPointToGeometryCurve(geometry: Geometry, target: Point2): CurveProjection {
  const analytic = projectPointToAnalyticGeometry(geometry, target);
  if (analytic) return analytic;
  let parameter = 0; let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (candidate: number) => {
    const point = evaluateGeometryCurve(geometry, candidate);
    const distance = Math.hypot(point.x_nm - target.x_nm, point.y_nm - target.y_nm);
    if (distance < bestDistance) { bestDistance = distance; parameter = candidate; }
  };
  const queue = curveSeedParameters(geometry).slice(1).map((end, index) => {
    const start = curveSeedParameters(geometry)[index];
    consider(start); consider((start + end) / 2); consider(end);
    return intervalNode(geometry, start, end, 0);
  });
  const tolerance = 5;
  let lowerBound = 0;
  while (queue.length) {
    queue.sort((a, b) => distanceToBounds(target, a.bounds) - distanceToBounds(target, b.bounds));
    const next = queue.shift()!;
    lowerBound = distanceToBounds(target, next.bounds);
    if (bestDistance - lowerBound <= tolerance) break;
    const middle = (next.start + next.end) / 2;
    if (middle === next.start || middle === next.end) break;
    consider(middle);
    queue.push(intervalNode(geometry, next.start, middle, next.depth + 1), intervalNode(geometry, middle, next.end, next.depth + 1));
  }
  let lo = Math.max(0, parameter - 1e-4); let hi = Math.min(1, parameter + 1e-4);
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const a = lo + (hi - lo) / 3; const b = hi - (hi - lo) / 3;
    const da = distanceAt(geometry, target, a); const db = distanceAt(geometry, target, b);
    if (da <= db) hi = b; else lo = a;
  }
  consider((lo + hi) / 2);
  const frame = evaluateCurveFrame(geometry, parameter);
  return { ...frame, parameter, distance_nm: bestDistance, error_bound_nm: Math.max(0, bestDistance - lowerBound) + 1 };
}

/**
 * Lines and round curves have closed-form projections. Sending them through
 * the certified branch-and-bound projector is unnecessary and, for ordinary
 * millimetre-scale circles, can consume hundreds of milliseconds while it
 * tries to prove a five-nanometre error bound on every pointer move.
 */
function projectPointToAnalyticGeometry(geometry: Geometry, target: Point2): CurveProjection | undefined {
  if (geometry.kind === "line") {
    const dx = geometry.end.x_nm - geometry.start.x_nm;
    const dy = geometry.end.y_nm - geometry.start.y_nm;
    const lengthSquared = dx * dx + dy * dy;
    const parameter = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((target.x_nm - geometry.start.x_nm) * dx + (target.y_nm - geometry.start.y_nm) * dy) / lengthSquared))
      : 0;
    const point = evaluateGeometryCurve(geometry, parameter);
    const length = Math.sqrt(lengthSquared) || 1;
    return {
      point,
      tangent: { x: dx / length, y: dy / length },
      curvature_per_nm: 0,
      parameter,
      distance_nm: Math.hypot(point.x_nm - target.x_nm, point.y_nm - target.y_nm),
      error_bound_nm: 1,
    };
  }
  if (geometry.kind === "ellipse" || geometry.kind === "elliptical_arc") return projectPointToEllipticGeometry(geometry, target);
  if (geometry.kind !== "circle" && geometry.kind !== "arc") return undefined;

  const center = geometry.center;
  const startAngle = geometry.kind === "circle"
    ? 0
    : Math.atan2(geometry.start.y_nm - center.y_nm, geometry.start.x_nm - center.x_nm);
  let sweep = Math.PI * 2;
  if (geometry.kind === "arc") {
    let endAngle = Math.atan2(geometry.end.y_nm - center.y_nm, geometry.end.x_nm - center.x_nm);
    if (geometry.clockwise) while (endAngle >= startAngle) endAngle -= Math.PI * 2;
    else while (endAngle <= startAngle) endAngle += Math.PI * 2;
    sweep = endAngle - startAngle;
  }
  const targetAngle = Math.atan2(target.y_nm - center.y_nm, target.x_nm - center.x_nm);
  let parameter = 0;
  if (geometry.kind === "circle") {
    const parameterAngle = targetAngle + (geometry.radius_nm < 0 ? Math.PI : 0);
    parameter = ((parameterAngle / (Math.PI * 2)) % 1 + 1) % 1;
  } else {
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let turn = -2; turn <= 2; turn += 1) {
      const candidateAngle = targetAngle + turn * Math.PI * 2;
      const candidate = Math.max(0, Math.min(1, (candidateAngle - startAngle) / sweep));
      const point = evaluateGeometryCurve(geometry, candidate);
      const distance = Math.hypot(point.x_nm - target.x_nm, point.y_nm - target.y_nm);
      if (distance < bestDistance) { bestDistance = distance; parameter = candidate; }
    }
  }
  const point = evaluateGeometryCurve(geometry, parameter);
  const radius = geometry.kind === "circle"
    ? Math.abs(geometry.radius_nm)
    : Math.hypot(geometry.start.x_nm - center.x_nm, geometry.start.y_nm - center.y_nm);
  const angle = startAngle + sweep * parameter;
  const orientation = Math.sign(sweep * (geometry.kind === "circle" && geometry.radius_nm < 0 ? -1 : 1)) || 1;
  return {
    point,
    tangent: { x: -Math.sin(angle) * orientation, y: Math.cos(angle) * orientation },
    curvature_per_nm: radius > 0 ? orientation / radius : 0,
    parameter,
    distance_nm: Math.hypot(point.x_nm - target.x_nm, point.y_nm - target.y_nm),
    error_bound_nm: 1,
  };
}

function projectPointToEllipticGeometry(
  geometry: Extract<Geometry, { kind: "ellipse" | "elliptical_arc" }>,
  target: Point2,
): CurveProjection {
  const center = geometry.center;
  const major = { x: geometry.major.x_nm - center.x_nm, y: geometry.major.y_nm - center.y_nm };
  const minor = { x: geometry.minor.x_nm - center.x_nm, y: geometry.minor.y_nm - center.y_nm };
  let startAngle = 0;
  let sweep = Math.PI * 2;
  if (geometry.kind === "elliptical_arc") {
    startAngle = ellipseParameter(center, geometry.major, geometry.minor, geometry.start);
    let endAngle = ellipseParameter(center, geometry.major, geometry.minor, geometry.end);
    if (geometry.clockwise) while (endAngle >= startAngle) endAngle -= Math.PI * 2;
    else while (endAngle <= startAngle) endAngle += Math.PI * 2;
    sweep = endAngle - startAngle;
  }
  const pointAt = (parameter: number) => {
    const angle = startAngle + sweep * parameter;
    const cosine = Math.cos(angle); const sine = Math.sin(angle);
    return {
      angle,
      x: center.x_nm + major.x * cosine + minor.x * sine,
      y: center.y_nm + major.y * cosine + minor.y * sine,
      dx: sweep * (-major.x * sine + minor.x * cosine),
      dy: sweep * (-major.y * sine + minor.y * cosine),
      ddx: sweep * sweep * (-major.x * cosine - minor.x * sine),
      ddy: sweep * sweep * (-major.y * cosine - minor.y * sine),
    };
  };
  let bestParameter = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const seedCount = 16;
  for (let seed = 0; seed <= seedCount; seed += 1) {
    let parameter = seed / seedCount;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const sample = pointAt(parameter);
      const rx = sample.x - target.x_nm; const ry = sample.y - target.y_nm;
      const first = rx * sample.dx + ry * sample.dy;
      const second = sample.dx * sample.dx + sample.dy * sample.dy + rx * sample.ddx + ry * sample.ddy;
      if (!Number.isFinite(second) || Math.abs(second) < 1e-12) break;
      const next = Math.max(0, Math.min(1, parameter - first / second));
      if (Math.abs(next - parameter) < 1e-12) { parameter = next; break; }
      parameter = next;
    }
    const sample = pointAt(parameter);
    const distance = Math.hypot(sample.x - target.x_nm, sample.y - target.y_nm);
    if (distance < bestDistance) { bestDistance = distance; bestParameter = parameter; }
  }
  const continuous = pointAt(bestParameter);
  const point = evaluateGeometryCurve(geometry, bestParameter);
  const tangentMagnitude = Math.hypot(continuous.dx, continuous.dy) || 1;
  return {
    point,
    tangent: { x: continuous.dx / tangentMagnitude, y: continuous.dy / tangentMagnitude },
    curvature_per_nm: (continuous.dx * continuous.ddy - continuous.dy * continuous.ddx) / Math.max(1, tangentMagnitude ** 3),
    parameter: bestParameter,
    distance_nm: Math.hypot(point.x_nm - target.x_nm, point.y_nm - target.y_nm),
    error_bound_nm: 2,
  };
}

/** Intersections of certified adaptive chords; knot spans are seeded explicitly. */
export function intersectGeometryCurves(first: Geometry, second: Geometry, _samples = 256): CurveIntersection[] {
  const tolerance = 2;
  const a = adaptiveCurveChords(first, tolerance);
  const b = adaptiveCurveChords(second, tolerance);
  const output: CurveIntersection[] = [];
  for (const firstChord of a) for (const secondChord of b) {
    if (!boundsOverlap(chordBounds(firstChord), chordBounds(secondChord), firstChord.error_bound_nm + secondChord.error_bound_nm)) continue;
    const hit = segmentIntersection(firstChord.a, firstChord.b, secondChord.a, secondChord.b);
    const closest = hit ? undefined : segmentClosestPair(firstChord.a, firstChord.b, secondChord.a, secondChord.b);
    if (!hit && (!closest || closest.distance > firstChord.error_bound_nm + secondChord.error_bound_nm + tolerance)) continue;
    const point = hit
      ? { x_nm: Math.round(hit.x), y_nm: Math.round(hit.y) }
      : { x_nm: Math.round((closest!.first.x_nm + closest!.second.x_nm) / 2), y_nm: Math.round((closest!.first.y_nm + closest!.second.y_nm) / 2) };
    if (output.some((candidate) => Math.hypot(candidate.point.x_nm - point.x_nm, candidate.point.y_nm - point.y_nm) <= 2)) continue;
    output.push({ point, first_parameter: firstChord.start + (firstChord.end - firstChord.start) * (hit?.a ?? closest!.firstParameter), second_parameter: secondChord.start + (secondChord.end - secondChord.start) * (hit?.b ?? closest!.secondParameter) });
  }
  return output.sort((left, right) => left.first_parameter - right.first_parameter);
}

/** Conservative curve bounds refined from derivative interval boxes. */
export function geometryCurveBounds(geometry: Geometry): CurveBounds {
  if (geometry.kind === "line") return { min: { x_nm: Math.min(geometry.start.x_nm, geometry.end.x_nm), y_nm: Math.min(geometry.start.y_nm, geometry.end.y_nm) }, max: { x_nm: Math.max(geometry.start.x_nm, geometry.end.x_nm), y_nm: Math.max(geometry.start.y_nm, geometry.end.y_nm) } };
  if (geometry.kind === "circle") return { min: { x_nm: geometry.center.x_nm - geometry.radius_nm, y_nm: geometry.center.y_nm - geometry.radius_nm }, max: { x_nm: geometry.center.x_nm + geometry.radius_nm, y_nm: geometry.center.y_nm + geometry.radius_nm } };
  if (geometry.kind === "ellipse") {
    const xRadius = Math.hypot(geometry.major.x_nm - geometry.center.x_nm, geometry.minor.x_nm - geometry.center.x_nm); const yRadius = Math.hypot(geometry.major.y_nm - geometry.center.y_nm, geometry.minor.y_nm - geometry.center.y_nm);
    return { min: { x_nm: Math.floor(geometry.center.x_nm - xRadius), y_nm: Math.floor(geometry.center.y_nm - yRadius) }, max: { x_nm: Math.ceil(geometry.center.x_nm + xRadius), y_nm: Math.ceil(geometry.center.y_nm + yRadius) } };
  }
  if (geometry.kind === "rectangle") return { min: { ...geometry.min }, max: { ...geometry.max } };
  if (geometry.kind === "sketch_point") return { min: { x_nm: geometry.x_nm, y_nm: geometry.y_nm }, max: { x_nm: geometry.x_nm, y_nm: geometry.y_nm } };
  const scale = geometryScale(geometry);
  const chords = adaptiveCurveChords(geometry, Math.max(2, scale * 1e-6));
  return chords.reduce<CurveBounds>((bounds, chord) => unionBounds(bounds, expandBounds(chordBounds(chord), chord.error_bound_nm)), {
    min: { x_nm: Number.POSITIVE_INFINITY, y_nm: Number.POSITIVE_INFINITY },
    max: { x_nm: Number.NEGATIVE_INFINITY, y_nm: Number.NEGATIVE_INFINITY },
  });
}

function distanceAt(geometry: Geometry, target: Point2, parameter: number): number {
  const point = evaluateGeometryCurve(geometry, parameter);
  return Math.hypot(point.x_nm - target.x_nm, point.y_nm - target.y_nm);
}

function curveSeedParameters(geometry: Geometry): number[] {
  const values = new Set<number>(Array.from({ length: 9 }, (_, index) => index / 8));
  if (geometry.kind === "control_point_spline") splineKnots(geometry).forEach((knot) => values.add(Math.max(0, Math.min(1, knot))));
  if (geometry.kind === "fit_point_spline") for (let index = 0; index < geometry.fit_points.length; index += 1) values.add(index / Math.max(1, geometry.fit_points.length - 1));
  return [...values].sort((a, b) => a - b).filter((value, index, list) => index === 0 || value > list[index - 1]);
}

/** Native topology-aware search seeds (including every real knot/fit span). */
export function geometryCurveSearchParameters(geometry: Geometry): number[] {
  return curveSeedParameters(geometry);
}

function derivativeBounds(geometry: Geometry): { x: number; y: number } {
  if (geometry.kind === "line") return { x: Math.abs(geometry.end.x_nm - geometry.start.x_nm), y: Math.abs(geometry.end.y_nm - geometry.start.y_nm) };
  if (geometry.kind === "circle") return { x: Math.PI * 2 * Math.abs(geometry.radius_nm), y: Math.PI * 2 * Math.abs(geometry.radius_nm) };
  if (geometry.kind === "arc") {
    const sweep = curveSweep(geometry); const radius = Math.hypot(geometry.start.x_nm - geometry.center.x_nm, geometry.start.y_nm - geometry.center.y_nm);
    return { x: Math.abs(sweep) * radius, y: Math.abs(sweep) * radius };
  }
  if (geometry.kind === "ellipse" || geometry.kind === "elliptical_arc") {
    const sweep = geometry.kind === "ellipse" ? Math.PI * 2 : Math.abs(curveSweep(geometry));
    return { x: sweep * (Math.abs(geometry.major.x_nm - geometry.center.x_nm) + Math.abs(geometry.minor.x_nm - geometry.center.x_nm)), y: sweep * (Math.abs(geometry.major.y_nm - geometry.center.y_nm) + Math.abs(geometry.minor.y_nm - geometry.center.y_nm)) };
  }
  if (geometry.kind === "control_point_spline") {
    const degree = geometry.degree; const knots = splineKnots(geometry); let x = 0; let y = 0;
    for (let index = 0; index + 1 < geometry.control_points.length; index += 1) {
      const denominator = knots[index + degree + 1] - knots[index + 1]; if (denominator <= 0) continue;
      x = Math.max(x, Math.abs(degree * (geometry.control_points[index + 1].x_nm - geometry.control_points[index].x_nm) / denominator));
      y = Math.max(y, Math.abs(degree * (geometry.control_points[index + 1].y_nm - geometry.control_points[index].y_nm) / denominator));
    }
    return { x: x + 1, y: y + 1 };
  }
  if (geometry.kind === "fit_point_spline") {
    let x = 0; let y = 0; const count = Math.max(1, geometry.fit_points.length - 1);
    for (let segment = 0; segment < count; segment += 1) {
      const p0 = geometry.fit_points[Math.max(0, segment - 1)]; const p1 = geometry.fit_points[segment]; const p2 = geometry.fit_points[segment + 1]; const p3 = geometry.fit_points[Math.min(geometry.fit_points.length - 1, segment + 2)];
      for (const axis of ["x_nm", "y_nm"] as const) {
        const c1 = -p0[axis] + p2[axis]; const c2 = 2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]; const c3 = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
        const bound = .5 * count * (Math.abs(c1) + 2 * Math.abs(c2) + 3 * Math.abs(c3)); if (axis === "x_nm") x = Math.max(x, bound); else y = Math.max(y, bound);
      }
    }
    return { x: x + 1, y: y + 1 };
  }
  if (geometry.kind === "conic") {
    const weight = Math.max(1e-6, geometry.weight_millionths / 1_000_000); const factor = 8 * Math.max(1, weight) / Math.min(1, weight) ** 2;
    return { x: factor * (Math.max(geometry.start.x_nm, geometry.control.x_nm, geometry.end.x_nm) - Math.min(geometry.start.x_nm, geometry.control.x_nm, geometry.end.x_nm) + 1), y: factor * (Math.max(geometry.start.y_nm, geometry.control.y_nm, geometry.end.y_nm) - Math.min(geometry.start.y_nm, geometry.control.y_nm, geometry.end.y_nm) + 1) };
  }
  if (geometry.kind === "rectangle") return { x: 4 * Math.abs(geometry.max.x_nm - geometry.min.x_nm), y: 4 * Math.abs(geometry.max.y_nm - geometry.min.y_nm) };
  return { x: 0, y: 0 };
}

function intervalNode(geometry: Geometry, start: number, end: number, depth: number): ParameterInterval {
  const a = evaluateGeometryCurve(geometry, start); const b = evaluateGeometryCurve(geometry, end);
  const deviation = secondDerivativeBound(geometry, start, end) * (end - start) ** 2 / 8 + 0.5;
  return { start, end, depth, bounds: expandBounds({ min: { x_nm: Math.min(a.x_nm, b.x_nm), y_nm: Math.min(a.y_nm, b.y_nm) }, max: { x_nm: Math.max(a.x_nm, b.x_nm), y_nm: Math.max(a.y_nm, b.y_nm) } }, deviation) };
}

function adaptiveCurveChords(geometry: Geometry, tolerance: number): CertifiedChord[] {
  const seeds = curveSeedParameters(geometry); const pending = seeds.slice(1).map((end, index) => intervalNode(geometry, seeds[index], end, 0)); const output: CertifiedChord[] = [];
  while (pending.length) {
    const interval = pending.pop()!; const a = evaluateGeometryCurve(geometry, interval.start); const b = evaluateGeometryCurve(geometry, interval.end);
    const error = boundsChordDeviation(interval.bounds, a, b);
    const middle = (interval.start + interval.end) / 2;
    if (error <= tolerance || middle === interval.start || middle === interval.end) output.push({ start: interval.start, end: interval.end, a, b, error_bound_nm: error });
    else pending.push(intervalNode(geometry, interval.start, middle, interval.depth + 1), intervalNode(geometry, middle, interval.end, interval.depth + 1));
  }
  return output.sort((left, right) => left.start - right.start);
}

function boundsChordDeviation(bounds: CurveBounds, a: Point2, b: Point2): number {
  return Math.max(...[{ x_nm: bounds.min.x_nm, y_nm: bounds.min.y_nm }, { x_nm: bounds.min.x_nm, y_nm: bounds.max.y_nm }, { x_nm: bounds.max.x_nm, y_nm: bounds.min.y_nm }, { x_nm: bounds.max.x_nm, y_nm: bounds.max.y_nm }].map((point) => pointSegmentDistance(point, a, b)));
}

function secondDerivativeBound(geometry: Geometry, start = 0, end = 1): number {
  if (geometry.kind === "line" || geometry.kind === "sketch_point" || geometry.kind === "rectangle") return 0;
  if (geometry.kind === "circle") return Math.abs(geometry.radius_nm) * (Math.PI * 2) ** 2;
  if (geometry.kind === "arc") return Math.hypot(geometry.start.x_nm - geometry.center.x_nm, geometry.start.y_nm - geometry.center.y_nm) * curveSweep(geometry) ** 2;
  if (geometry.kind === "ellipse" || geometry.kind === "elliptical_arc") {
    const frequency = geometry.kind === "ellipse" ? Math.PI * 2 : Math.abs(curveSweep(geometry));
    return frequency ** 2 * (Math.hypot(geometry.major.x_nm - geometry.center.x_nm, geometry.major.y_nm - geometry.center.y_nm) + Math.hypot(geometry.minor.x_nm - geometry.center.x_nm, geometry.minor.y_nm - geometry.center.y_nm));
  }
  if (geometry.kind === "control_point_spline") {
    const degree = geometry.degree; if (degree < 2) return 0;
    const knots = splineKnots(geometry);
    const first: Array<{ x: number; y: number }> = [];
    for (let index = 0; index + 1 < geometry.control_points.length; index += 1) {
      const denominator = knots[index + degree + 1] - knots[index + 1];
      first.push(denominator > 0 ? { x: degree * (geometry.control_points[index + 1].x_nm - geometry.control_points[index].x_nm) / denominator, y: degree * (geometry.control_points[index + 1].y_nm - geometry.control_points[index].y_nm) / denominator } : { x: 0, y: 0 });
    }
    let bound = 0;
    for (let index = 0; index + 1 < first.length; index += 1) {
      const denominator = knots[index + degree + 1] - knots[index + 2]; if (denominator <= 0) continue;
      const supportStart = knots[index + 2]; const supportEnd = knots[index + degree + 1];
      if (supportEnd < start || supportStart > end) continue;
      bound = Math.max(bound, Math.hypot((degree - 1) * (first[index + 1].x - first[index].x) / denominator, (degree - 1) * (first[index + 1].y - first[index].y) / denominator));
    }
    return bound + 2;
  }
  if (geometry.kind === "fit_point_spline") {
    let bound = 0; const count = Math.max(1, geometry.fit_points.length - 1);
    for (let segment = 0; segment < count; segment += 1) {
      if ((segment + 1) / count < start || segment / count > end) continue;
      const p0 = geometry.fit_points[Math.max(0, segment - 1)]; const p1 = geometry.fit_points[segment]; const p2 = geometry.fit_points[segment + 1]; const p3 = geometry.fit_points[Math.min(geometry.fit_points.length - 1, segment + 2)];
      const axisBound = (axis: "x_nm" | "y_nm") => { const c2 = 2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]; const c3 = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]; return .5 * count ** 2 * (2 * Math.abs(c2) + 6 * Math.abs(c3)); };
      bound = Math.max(bound, Math.hypot(axisBound("x_nm"), axisBound("y_nm")));
    }
    return bound + 2;
  }
  const weight = Math.max(1e-6, geometry.weight_millionths / 1_000_000); const scale = Math.max(Math.hypot(geometry.control.x_nm - geometry.start.x_nm, geometry.control.y_nm - geometry.start.y_nm), Math.hypot(geometry.end.x_nm - geometry.control.x_nm, geometry.end.y_nm - geometry.control.y_nm));
  return 64 * (scale + 1) * Math.max(1, weight) ** 2 / Math.min(1, weight) ** 4;
}

function pointSegmentDistance(point: Point2, a: Point2, b: Point2): number {
  const dx = b.x_nm - a.x_nm; const dy = b.y_nm - a.y_nm; const denominator = dx * dx + dy * dy;
  const parameter = denominator ? Math.max(0, Math.min(1, ((point.x_nm - a.x_nm) * dx + (point.y_nm - a.y_nm) * dy) / denominator)) : 0;
  return Math.hypot(point.x_nm - (a.x_nm + parameter * dx), point.y_nm - (a.y_nm + parameter * dy));
}

function splineKnots(geometry: Extract<Geometry, { kind: "control_point_spline" }>): number[] {
  if (geometry.knots_millionths?.length === geometry.control_points.length + geometry.degree + 1) return geometry.knots_millionths.map((value) => value / 1_000_000);
  const spans = Math.max(1, geometry.control_points.length - geometry.degree);
  return Array.from({ length: geometry.control_points.length + geometry.degree + 1 }, (_, index) => index <= geometry.degree ? 0 : index >= geometry.control_points.length ? 1 : (index - geometry.degree) / spans);
}

function distanceToBounds(point: Point2, bounds: CurveBounds): number { return Math.hypot(Math.max(bounds.min.x_nm - point.x_nm, 0, point.x_nm - bounds.max.x_nm), Math.max(bounds.min.y_nm - point.y_nm, 0, point.y_nm - bounds.max.y_nm)); }
function chordBounds(chord: CertifiedChord): CurveBounds { return { min: { x_nm: Math.min(chord.a.x_nm, chord.b.x_nm), y_nm: Math.min(chord.a.y_nm, chord.b.y_nm) }, max: { x_nm: Math.max(chord.a.x_nm, chord.b.x_nm), y_nm: Math.max(chord.a.y_nm, chord.b.y_nm) } }; }
function expandBounds(bounds: CurveBounds, amount: number): CurveBounds { return { min: { x_nm: bounds.min.x_nm - amount, y_nm: bounds.min.y_nm - amount }, max: { x_nm: bounds.max.x_nm + amount, y_nm: bounds.max.y_nm + amount } }; }
function unionBounds(a: CurveBounds, b: CurveBounds): CurveBounds { return { min: { x_nm: Math.min(a.min.x_nm, b.min.x_nm), y_nm: Math.min(a.min.y_nm, b.min.y_nm) }, max: { x_nm: Math.max(a.max.x_nm, b.max.x_nm), y_nm: Math.max(a.max.y_nm, b.max.y_nm) } }; }
function boundsOverlap(a: CurveBounds, b: CurveBounds, padding: number): boolean { return a.min.x_nm <= b.max.x_nm + padding && a.max.x_nm + padding >= b.min.x_nm && a.min.y_nm <= b.max.y_nm + padding && a.max.y_nm + padding >= b.min.y_nm; }
function geometryScale(geometry: Geometry): number { const points = curveSeedParameters(geometry).map((parameter) => evaluateGeometryCurve(geometry, parameter)); return Math.hypot(Math.max(...points.map((point) => point.x_nm)) - Math.min(...points.map((point) => point.x_nm)), Math.max(...points.map((point) => point.y_nm)) - Math.min(...points.map((point) => point.y_nm))); }
function curveSweep(geometry: Extract<Geometry, { kind: "arc" | "elliptical_arc" }>): number { const start = geometry.kind === "arc" ? Math.atan2(geometry.start.y_nm - geometry.center.y_nm, geometry.start.x_nm - geometry.center.x_nm) : ellipseParameter(geometry.center, geometry.major, geometry.minor, geometry.start); let end = geometry.kind === "arc" ? Math.atan2(geometry.end.y_nm - geometry.center.y_nm, geometry.end.x_nm - geometry.center.x_nm) : ellipseParameter(geometry.center, geometry.major, geometry.minor, geometry.end); if (geometry.clockwise) while (end >= start) end -= Math.PI * 2; else while (end <= start) end += Math.PI * 2; return end - start; }

function segmentIntersection(a0: Point2, a1: Point2, b0: Point2, b1: Point2): { x: number; y: number; a: number; b: number } | undefined {
  const adx = a1.x_nm - a0.x_nm; const ady = a1.y_nm - a0.y_nm; const bdx = b1.x_nm - b0.x_nm; const bdy = b1.y_nm - b0.y_nm;
  const denominator = adx * bdy - ady * bdx; if (Math.abs(denominator) < 1e-9) return undefined;
  const ox = b0.x_nm - a0.x_nm; const oy = b0.y_nm - a0.y_nm;
  const ta = (ox * bdy - oy * bdx) / denominator; const tb = (ox * ady - oy * adx) / denominator;
  return ta >= 0 && ta <= 1 && tb >= 0 && tb <= 1 ? { x: a0.x_nm + adx * ta, y: a0.y_nm + ady * ta, a: ta, b: tb } : undefined;
}

function segmentClosestPair(a0: Point2, a1: Point2, b0: Point2, b1: Point2): { first: Point2; second: Point2; firstParameter: number; secondParameter: number; distance: number } {
  const candidates: Array<{ firstParameter: number; secondParameter: number }> = [];
  const projection = (point: Point2, start: Point2, end: Point2) => { const dx = end.x_nm - start.x_nm; const dy = end.y_nm - start.y_nm; const denominator = dx * dx + dy * dy; return denominator ? Math.max(0, Math.min(1, ((point.x_nm - start.x_nm) * dx + (point.y_nm - start.y_nm) * dy) / denominator)) : 0; };
  candidates.push({ firstParameter: 0, secondParameter: projection(a0, b0, b1) }, { firstParameter: 1, secondParameter: projection(a1, b0, b1) }, { firstParameter: projection(b0, a0, a1), secondParameter: 0 }, { firstParameter: projection(b1, a0, a1), secondParameter: 1 });
  return candidates.map(({ firstParameter, secondParameter }) => {
    const first = { x_nm: a0.x_nm + (a1.x_nm - a0.x_nm) * firstParameter, y_nm: a0.y_nm + (a1.y_nm - a0.y_nm) * firstParameter }; const second = { x_nm: b0.x_nm + (b1.x_nm - b0.x_nm) * secondParameter, y_nm: b0.y_nm + (b1.y_nm - b0.y_nm) * secondParameter };
    return { first, second, firstParameter, secondParameter, distance: Math.hypot(first.x_nm - second.x_nm, first.y_nm - second.y_nm) };
  }).sort((left, right) => left.distance - right.distance)[0];
}
