import type { Geometry, Point2, Sketch } from "./sketch-editor";
import { planeLocalToWorldMillimeters, type ResolvedSketchPlane } from "./sketch-plane.ts";
import { sampleConic, sampleControlPointSpline, sampleEllipse, sampleEllipticalArc, sampleFitPointSpline } from "./sketch-spline.ts";

export type CommittedSketchPolyline = {
  entityId: string;
  construction: boolean;
  points: readonly (readonly [number, number, number])[];
};

/** Tessellate every supported non-spline sketch primitive without changing its plane-local coordinates. */
export function sketchGeometryPolylines(geometry: Geometry): Point2[][] {
  if (geometry.kind === "line") return [[geometry.start, geometry.end]];
  if (geometry.kind === "control_point_spline") return [sampleControlPointSpline(geometry.control_points, 48, geometry.degree, geometry.knots_millionths)];
  if (geometry.kind === "fit_point_spline") return [sampleFitPointSpline(geometry.fit_points)];
  if (geometry.kind === "ellipse") return [sampleEllipse(geometry.center, geometry.major, geometry.minor)];
  if (geometry.kind === "elliptical_arc") return [sampleEllipticalArc(geometry.center, geometry.major, geometry.minor, geometry.start, geometry.end, geometry.clockwise)];
  if (geometry.kind === "conic") return [sampleConic(geometry.start, geometry.control, geometry.end, geometry.weight_millionths)];
  if (geometry.kind === "sketch_point") {
    const size = 250_000;
    return [[{ x_nm: geometry.x_nm - size, y_nm: geometry.y_nm }, { x_nm: geometry.x_nm + size, y_nm: geometry.y_nm }], [{ x_nm: geometry.x_nm, y_nm: geometry.y_nm - size }, { x_nm: geometry.x_nm, y_nm: geometry.y_nm + size }]];
  }
  if (geometry.kind === "rectangle") {
    return [[
      geometry.min,
      { x_nm: geometry.max.x_nm, y_nm: geometry.min.y_nm },
      geometry.max,
      { x_nm: geometry.min.x_nm, y_nm: geometry.max.y_nm },
      geometry.min,
    ]];
  }
  const sampleCount = geometry.kind === "circle" ? 64 : 48;
  const radius = geometry.kind === "circle"
    ? geometry.radius_nm
    : Math.hypot(geometry.start.x_nm - geometry.center.x_nm, geometry.start.y_nm - geometry.center.y_nm);
  const startAngle = geometry.kind === "circle" ? 0 : Math.atan2(geometry.start.y_nm - geometry.center.y_nm, geometry.start.x_nm - geometry.center.x_nm);
  let sweep = Math.PI * 2;
  if (geometry.kind === "arc") {
    sweep = Math.atan2(geometry.end.y_nm - geometry.center.y_nm, geometry.end.x_nm - geometry.center.x_nm) - startAngle;
    if (geometry.clockwise) while (sweep >= 0) sweep -= Math.PI * 2;
    else while (sweep <= 0) sweep += Math.PI * 2;
  }
  return [Array.from({ length: sampleCount + 1 }, (_, index) => {
    const angle = startAngle + sweep * index / sampleCount;
    return {
      x_nm: geometry.center.x_nm + Math.round(Math.cos(angle) * radius),
      y_nm: geometry.center.y_nm + Math.round(Math.sin(angle) * radius),
    };
  })];
}

/** Map accepted sketch geometry into its durable world-space support plane. */
export function committedSketchWorldPolylines(sketch: Sketch, plane: ResolvedSketchPlane): CommittedSketchPolyline[] {
  return Object.values(sketch.geometry).flatMap((entity) => sketchGeometryPolylines(entity.geometry).map((polyline) => ({
    entityId: entity.id,
    construction: Boolean(entity.construction),
    points: polyline.map((point) => planeLocalToWorldMillimeters(point, plane)),
  })));
}
