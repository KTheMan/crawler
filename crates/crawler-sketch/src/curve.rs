use crate::{
    Arc, Circle, Conic, ControlPointSpline, Ellipse, EllipticalArc, FitPointSpline, Geometry, Line,
    Point2, Rectangle,
};
use std::cell::Cell;
use thiserror::Error;

/// Durable committed-offset tolerance. This is expressed in model units and
/// must not vary with zoom, viewport size, or display tessellation.
pub const OFFSET_MODEL_TOLERANCE_NM: i64 = 1_000;
pub const MAX_OFFSET_SPANS_PER_SOURCE_SIDE: usize = 256;
pub const MAX_CERTIFICATION_NODES: usize = 32_768;
pub const MAX_CERT_DEPTH: u8 = 24;

thread_local! {
    static OFFSET_GENERATOR_CALLS: Cell<u64> = const { Cell::new(0) };
}

#[derive(Clone, Debug, Error, PartialEq)]
pub enum OffsetCurveError {
    #[error(
        "offset_tolerance_unattainable: tolerance {tolerance_nm} nm within {max_spans} spans, {max_nodes} nodes, and depth {max_depth}"
    )]
    OffsetToleranceUnattainable {
        tolerance_nm: i64,
        max_spans: usize,
        max_nodes: usize,
        max_depth: u8,
    },
    #[error("singular_offset: the requested offset has a nonfinite or degenerate frame")]
    SingularOffset,
}

/// Phase-local instrumentation. The counter is thread-local so parallel test
/// workers cannot corrupt one another's call-count assertions.
pub fn offset_generation_call_count() -> u64 {
    OFFSET_GENERATOR_CALLS.with(Cell::get)
}

#[doc(hidden)]
pub fn reset_offset_generation_call_count() {
    OFFSET_GENERATOR_CALLS.with(|calls| calls.set(0));
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurveFrame {
    pub point: Point2,
    pub tangent: [f64; 2],
    pub curvature_per_nm: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurveProjection {
    pub parameter: f64,
    pub frame: CurveFrame,
    pub distance_nm: f64,
    /// Proven additive distance error relative to the global closest point.
    pub error_bound_nm: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurveIntersection {
    pub point: Point2,
    pub first_parameter: f64,
    pub second_parameter: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CurveBounds {
    pub min: Point2,
    pub max: Point2,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OffsetCurvePiece {
    pub geometry: Geometry,
    pub source_start: f64,
    pub source_end: f64,
    /// True only when `error_bound_nm` is a conservative analytic bound.
    /// Durable offset APIs never return a piece with this set to false.
    pub certified: bool,
    /// Conservative analytic maximum-error bound in model nanometers.
    pub error_bound_nm: f64,
}

pub fn evaluate_curve(geometry: &Geometry, parameter: f64) -> Point2 {
    let t = parameter.clamp(0.0, 1.0);
    match geometry {
        Geometry::Line(line) => lerp(line.start, line.end, t),
        Geometry::Circle(circle) => {
            let angle = t * std::f64::consts::TAU;
            round_point(
                circle.center.x_nm as f64 + circle.radius_nm as f64 * angle.cos(),
                circle.center.y_nm as f64 + circle.radius_nm as f64 * angle.sin(),
            )
        }
        Geometry::Arc(arc) => {
            let start = angle(arc.center, arc.start);
            let mut end = angle(arc.center, arc.end);
            if arc.clockwise {
                while end >= start {
                    end -= std::f64::consts::TAU;
                }
            } else {
                while end <= start {
                    end += std::f64::consts::TAU;
                }
            }
            let radius = distance(arc.center, arc.start);
            let theta = start + (end - start) * t;
            round_point(
                arc.center.x_nm as f64 + radius * theta.cos(),
                arc.center.y_nm as f64 + radius * theta.sin(),
            )
        }
        Geometry::Rectangle(rectangle) => {
            let corners = [
                rectangle.min,
                Point2::new(rectangle.max.x_nm, rectangle.min.y_nm),
                rectangle.max,
                Point2::new(rectangle.min.x_nm, rectangle.max.y_nm),
                rectangle.min,
            ];
            let scaled = t * 4.0;
            let index = (scaled.floor() as usize).min(3);
            lerp(
                corners[index],
                corners[index + 1],
                if scaled >= 4.0 {
                    1.0
                } else {
                    scaled - index as f64
                },
            )
        }
        Geometry::ControlPointSpline(spline) => b_spline(spline, t),
        Geometry::FitPointSpline(spline) => catmull_rom(&spline.fit_points, t),
        Geometry::Ellipse(ellipse) => ellipse_point(
            ellipse.center,
            ellipse.major,
            ellipse.minor,
            t * std::f64::consts::TAU,
        ),
        Geometry::EllipticalArc(arc) => {
            let start = ellipse_angle(arc.center, arc.major, arc.minor, arc.start);
            let mut end = ellipse_angle(arc.center, arc.major, arc.minor, arc.end);
            if arc.clockwise {
                while end >= start {
                    end -= std::f64::consts::TAU;
                }
            } else {
                while end <= start {
                    end += std::f64::consts::TAU;
                }
            }
            ellipse_point(arc.center, arc.major, arc.minor, start + (end - start) * t)
        }
        Geometry::Conic(conic) => {
            let inverse = 1.0 - t;
            let weight = conic.weight_millionths as f64 / 1_000_000.0;
            let a = inverse * inverse;
            let b = 2.0 * weight * inverse * t;
            let c = t * t;
            let denominator = a + b + c;
            round_point(
                (a * conic.start.x_nm as f64
                    + b * conic.control.x_nm as f64
                    + c * conic.end.x_nm as f64)
                    / denominator,
                (a * conic.start.y_nm as f64
                    + b * conic.control.y_nm as f64
                    + c * conic.end.y_nm as f64)
                    / denominator,
            )
        }
        Geometry::SketchPoint(point) => *point,
    }
}

const CURVE_APPROXIMATION_TOLERANCE_NM: f64 = 2.0;

/// Deterministic, scale-adaptive plane-local bounds. Chords are accepted only
/// when a conservative analytic/control-hull bound proves the entire native
/// curve interval is within the declared two-nanometer tolerance.
pub fn curve_bounds(geometry: &Geometry) -> CurveBounds {
    let samples = adaptive_curve_samples(geometry, 8);
    let mut min = samples[0].1;
    let mut max = min;
    for (_, point) in samples.into_iter().skip(1) {
        min.x_nm = min.x_nm.min(point.x_nm);
        min.y_nm = min.y_nm.min(point.y_nm);
        max.x_nm = max.x_nm.max(point.x_nm);
        max.y_nm = max.y_nm.max(point.y_nm);
    }
    let margin = CURVE_APPROXIMATION_TOLERANCE_NM.ceil() as i64;
    min.x_nm -= margin;
    min.y_nm -= margin;
    max.x_nm += margin;
    max.y_nm += margin;
    CurveBounds { min, max }
}

pub(crate) fn adaptive_curve_samples(
    geometry: &Geometry,
    seed_segments: usize,
) -> Vec<(f64, Point2)> {
    let cuts = curve_seed_parameters(geometry, seed_segments);
    let mut output = vec![(cuts[0], evaluate_curve(geometry, cuts[0]))];
    for window in cuts.windows(2) {
        let a = window[0];
        let b = window[1];
        adaptive_curve_interval(
            geometry,
            a,
            evaluate_curve(geometry, a),
            b,
            evaluate_curve(geometry, b),
            0,
            &mut output,
        );
    }
    output
}

fn curve_seed_parameters(geometry: &Geometry, seed_segments: usize) -> Vec<f64> {
    let mut cuts = match geometry {
        Geometry::Rectangle(_) => vec![0.0, 0.25, 0.5, 0.75, 1.0],
        Geometry::FitPointSpline(value) => (0..value.fit_points.len())
            .map(|index| index as f64 / value.fit_points.len().saturating_sub(1).max(1) as f64)
            .collect(),
        Geometry::ControlPointSpline(value) => control_spline_knots(value),
        _ => {
            let segments = seed_segments.max(1);
            (0..=segments)
                .map(|index| index as f64 / segments as f64)
                .collect()
        }
    };
    cuts.push(0.0);
    cuts.push(1.0);
    cuts.retain(|value| value.is_finite() && (0.0..=1.0).contains(value));
    cuts.sort_by(f64::total_cmp);
    cuts.dedup_by(|a, b| (*a - *b).abs() <= 1.0e-12);
    cuts
}

fn adaptive_curve_interval(
    geometry: &Geometry,
    a: f64,
    pa: Point2,
    b: f64,
    pb: Point2,
    depth: u8,
    output: &mut Vec<(f64, Point2)>,
) {
    let middle = (a + b) * 0.5;
    let pm = evaluate_curve(geometry, middle);
    let bounded =
        curve_interval_deviation_bound(geometry, a, b, pa, pb) <= CURVE_APPROXIMATION_TOLERANCE_NM;
    if bounded || depth >= 32 || b - a <= 1.0e-12 {
        output.push((b, pb));
        return;
    }
    adaptive_curve_interval(geometry, a, pa, middle, pm, depth + 1, output);
    adaptive_curve_interval(geometry, middle, pm, b, pb, depth + 1, output);
}

fn curve_interval_deviation_bound(
    geometry: &Geometry,
    start: f64,
    end: f64,
    a: Point2,
    b: Point2,
) -> f64 {
    match geometry {
        Geometry::Line(_) | Geometry::Rectangle(_) | Geometry::SketchPoint(_) => 0.0,
        Geometry::Circle(value) => {
            value.radius_nm as f64 * (std::f64::consts::TAU * (end - start)).powi(2) / 8.0 + 1.0
        }
        Geometry::Arc(value) => {
            let sweep = arc_sweep(value).abs();
            distance(value.center, value.start) * (sweep * (end - start)).powi(2) / 8.0 + 1.0
        }
        Geometry::Ellipse(value) => {
            distance(value.center, value.major).max(distance(value.center, value.minor))
                * (std::f64::consts::TAU * (end - start)).powi(2)
                / 8.0
                + 1.0
        }
        Geometry::EllipticalArc(value) => {
            distance(value.center, value.major).max(distance(value.center, value.minor))
                * (elliptical_arc_sweep(value).abs() * (end - start)).powi(2)
                / 8.0
                + 1.0
        }
        Geometry::ControlPointSpline(value) => control_spline_interval(value, start, end)
            .control_points
            .iter()
            .map(|point| point_line_deviation(*point, a, b))
            .fold(0.0, f64::max),
        Geometry::FitPointSpline(value) => fit_spline_interval_bezier(value, start, end)
            .iter()
            .map(|point| point_line_deviation_float(*point, a, b))
            .fold(0.0, f64::max),
        Geometry::Conic(value) => {
            let interval = conic_interval(value, start, end);
            point_line_deviation(interval.control, a, b).max(1.0)
        }
    }
}

fn point_line_deviation_float(point: [f64; 2], a: Point2, b: Point2) -> f64 {
    let dx = (b.x_nm - a.x_nm) as f64;
    let dy = (b.y_nm - a.y_nm) as f64;
    let length = dx.hypot(dy);
    if length <= f64::EPSILON {
        return (point[0] - a.x_nm as f64).hypot(point[1] - a.y_nm as f64);
    }
    let projection = (((point[0] - a.x_nm as f64) * dx + (point[1] - a.y_nm as f64) * dy)
        / (length * length))
        .clamp(0.0, 1.0);
    (point[0] - (a.x_nm as f64 + projection * dx))
        .hypot(point[1] - (a.y_nm as f64 + projection * dy))
}

fn arc_sweep(value: &Arc) -> f64 {
    let start = angle(value.center, value.start);
    let mut end = angle(value.center, value.end);
    if value.clockwise {
        while end >= start {
            end -= std::f64::consts::TAU;
        }
    } else {
        while end <= start {
            end += std::f64::consts::TAU;
        }
    }
    end - start
}

fn elliptical_arc_sweep(value: &EllipticalArc) -> f64 {
    let start = ellipse_angle(value.center, value.major, value.minor, value.start);
    let mut end = ellipse_angle(value.center, value.major, value.minor, value.end);
    if value.clockwise {
        while end >= start {
            end -= std::f64::consts::TAU;
        }
    } else {
        while end <= start {
            end += std::f64::consts::TAU;
        }
    }
    end - start
}

fn point_line_deviation(point: Point2, a: Point2, b: Point2) -> f64 {
    let dx = (b.x_nm - a.x_nm) as f64;
    let dy = (b.y_nm - a.y_nm) as f64;
    let length = dx.hypot(dy);
    if length <= f64::EPSILON {
        return distance(point, a);
    }
    let projection = (((point.x_nm - a.x_nm) as f64 * dx + (point.y_nm - a.y_nm) as f64 * dy)
        / (length * length))
        .clamp(0.0, 1.0);
    (point.x_nm as f64 - (a.x_nm as f64 + projection * dx))
        .hypot(point.y_nm as f64 - (a.y_nm as f64 + projection * dy))
}

/// Split a native curve at stable normalized parameters. Exact native kinds
/// remain exact; freeform intervals remain editable native fit splines.
pub fn split_curve(geometry: &Geometry, parameters: &[f64]) -> Vec<Geometry> {
    let mut cuts = vec![0.0];
    cuts.extend(
        parameters
            .iter()
            .copied()
            .filter(|value| *value > 0.0 && *value < 1.0),
    );
    if let Geometry::FitPointSpline(value) = geometry {
        cuts.extend(
            (1..value.fit_points.len().saturating_sub(1))
                .map(|index| index as f64 / value.fit_points.len().saturating_sub(1).max(1) as f64),
        );
    }
    cuts.push(1.0);
    cuts.sort_by(f64::total_cmp);
    cuts.dedup_by(|a, b| (*a - *b).abs() < 1.0e-9);
    cuts.windows(2)
        .map(|window| curve_interval(geometry, window[0], window[1]))
        .collect()
}

fn curve_interval(geometry: &Geometry, start: f64, end: f64) -> Geometry {
    let a = evaluate_curve(geometry, start);
    let b = evaluate_curve(geometry, end);
    match geometry {
        Geometry::Line(_) => Geometry::Line(Line { start: a, end: b }),
        Geometry::Arc(value) => Geometry::Arc(Arc {
            center: value.center,
            start: a,
            end: b,
            clockwise: value.clockwise,
        }),
        Geometry::EllipticalArc(value) => Geometry::EllipticalArc(EllipticalArc {
            center: value.center,
            major: value.major,
            minor: value.minor,
            start: a,
            end: b,
            clockwise: value.clockwise,
        }),
        Geometry::Ellipse(value) => Geometry::EllipticalArc(EllipticalArc {
            center: value.center,
            major: value.major,
            minor: value.minor,
            start: a,
            end: b,
            clockwise: false,
        }),
        Geometry::Circle(value) => Geometry::Arc(Arc {
            center: value.center,
            start: a,
            end: b,
            clockwise: false,
        }),
        Geometry::Rectangle(_) => Geometry::Line(Line { start: a, end: b }),
        Geometry::ControlPointSpline(value) => {
            Geometry::ControlPointSpline(control_spline_interval(value, start, end))
        }
        Geometry::Conic(value) => Geometry::Conic(conic_interval(value, start, end)),
        Geometry::FitPointSpline(value) => Geometry::ControlPointSpline(ControlPointSpline {
            degree: 3,
            control_points: fit_spline_interval_bezier(value, start, end)
                .map(|point| round_point(point[0], point[1]))
                .to_vec(),
            knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
        }),
        _ => Geometry::FitPointSpline(FitPointSpline {
            fit_points: [0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0]
                .map(|u| evaluate_curve(geometry, start + (end - start) * u))
                .to_vec(),
        }),
    }
}

fn control_spline_interval(
    spline: &ControlPointSpline,
    start: f64,
    end: f64,
) -> ControlPointSpline {
    let left = if end < 1.0 {
        split_control_spline(spline, end).0
    } else {
        spline.clone()
    };
    if start <= 0.0 {
        return left;
    }
    split_control_spline(&left, (start / end.max(f64::EPSILON)).clamp(0.0, 1.0)).1
}

fn split_control_spline(
    spline: &ControlPointSpline,
    parameter: f64,
) -> (ControlPointSpline, ControlPointSpline) {
    let degree = usize::from(spline.degree);
    let parameter = parameter.clamp(1.0e-9, 1.0 - 1.0e-9);
    let mut points = spline
        .control_points
        .iter()
        .map(|point| [point.x_nm as f64, point.y_nm as f64])
        .collect::<Vec<_>>();
    let mut knots = control_spline_knots(spline);
    let multiplicity = knots
        .iter()
        .filter(|value| (**value - parameter).abs() <= 1.0e-9)
        .count();
    for _ in multiplicity..degree {
        insert_control_spline_knot(&mut points, &mut knots, degree, parameter);
    }
    let span = (degree..points.len())
        .find(|index| parameter < knots[index + 1] - 1.0e-12)
        .unwrap_or(points.len() - 1);
    let split = span - degree;
    let left_points = points[..=split].to_vec();
    let right_points = points[split..].to_vec();
    let mut left_knots = knots[..=span].to_vec();
    left_knots.push(parameter);
    let mut right_knots = vec![parameter];
    right_knots.extend_from_slice(&knots[span - degree + 1..]);
    let make = |points: Vec<[f64; 2]>, knots: Vec<f64>, low: f64, high: f64| ControlPointSpline {
        degree: spline.degree,
        control_points: points
            .into_iter()
            .map(|point| round_point(point[0], point[1]))
            .collect(),
        knots_millionths: knots
            .into_iter()
            .map(|value| {
                (((value - low) / (high - low)).clamp(0.0, 1.0) * 1_000_000.0).round() as u32
            })
            .collect(),
    };
    (
        make(left_points, left_knots, 0.0, parameter),
        make(right_points, right_knots, parameter, 1.0),
    )
}

fn insert_control_spline_knot(
    points: &mut Vec<[f64; 2]>,
    knots: &mut Vec<f64>,
    degree: usize,
    parameter: f64,
) {
    let n = points.len() - 1;
    let span = (degree..=n)
        .find(|index| parameter < knots[index + 1] - 1.0e-12)
        .unwrap_or(n);
    let multiplicity = knots
        .iter()
        .filter(|value| (**value - parameter).abs() <= 1.0e-9)
        .count();
    let mut next = vec![[0.0; 2]; points.len() + 1];
    next[..=span - degree].copy_from_slice(&points[..=span - degree]);
    next[(span - multiplicity + 1)..(n + 2)]
        .copy_from_slice(&points[(span - multiplicity)..(n + 1)]);
    for index in span - degree + 1..=span - multiplicity {
        let denominator = knots[index + degree] - knots[index];
        let alpha = if denominator.abs() <= f64::EPSILON {
            0.0
        } else {
            (parameter - knots[index]) / denominator
        };
        next[index] = [
            (1.0 - alpha) * points[index - 1][0] + alpha * points[index][0],
            (1.0 - alpha) * points[index - 1][1] + alpha * points[index][1],
        ];
    }
    *points = next;
    knots.insert(span + 1, parameter);
}

fn fit_spline_interval_bezier(spline: &FitPointSpline, start: f64, end: f64) -> [[f64; 2]; 4] {
    let count = spline.fit_points.len();
    if count < 2 {
        let point = spline
            .fit_points
            .first()
            .copied()
            .unwrap_or(Point2::new(0, 0));
        return [[point.x_nm as f64, point.y_nm as f64]; 4];
    }
    let segments = count - 1;
    let midpoint = (start + end) * 0.5;
    let segment = ((midpoint * segments as f64).floor() as usize).min(segments - 1);
    let p0 = spline.fit_points[segment.saturating_sub(1)];
    let p1 = spline.fit_points[segment];
    let p2 = spline.fit_points[segment + 1];
    let p3 = spline.fit_points[(segment + 2).min(count - 1)];
    let point = |value: Point2| [value.x_nm as f64, value.y_nm as f64];
    let p0 = point(p0);
    let p1 = point(p1);
    let p2 = point(p2);
    let p3 = point(p3);
    let original = [
        p1,
        [p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0],
        [p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0],
        p2,
    ];
    let local_start = (start * segments as f64 - segment as f64).clamp(0.0, 1.0);
    let local_end = (end * segments as f64 - segment as f64).clamp(0.0, 1.0);
    let (left, _) = split_cubic_bezier(original, local_end);
    if local_start <= 0.0 {
        return left;
    }
    let (_, interval) = split_cubic_bezier(
        left,
        (local_start / local_end.max(f64::EPSILON)).clamp(0.0, 1.0),
    );
    interval
}

fn split_cubic_bezier(points: [[f64; 2]; 4], parameter: f64) -> ([[f64; 2]; 4], [[f64; 2]; 4]) {
    let mix = |a: [f64; 2], b: [f64; 2]| {
        [
            a[0] + (b[0] - a[0]) * parameter,
            a[1] + (b[1] - a[1]) * parameter,
        ]
    };
    let a = mix(points[0], points[1]);
    let b = mix(points[1], points[2]);
    let c = mix(points[2], points[3]);
    let d = mix(a, b);
    let e = mix(b, c);
    let middle = mix(d, e);
    ([points[0], a, d, middle], [middle, e, c, points[3]])
}

#[derive(Clone, Copy)]
struct HomogeneousPoint {
    x: f64,
    y: f64,
    weight: f64,
}

fn split_homogeneous(
    points: [HomogeneousPoint; 3],
    parameter: f64,
) -> ([HomogeneousPoint; 3], [HomogeneousPoint; 3]) {
    let mix = |a: HomogeneousPoint, b: HomogeneousPoint| HomogeneousPoint {
        x: a.x + (b.x - a.x) * parameter,
        y: a.y + (b.y - a.y) * parameter,
        weight: a.weight + (b.weight - a.weight) * parameter,
    };
    let a = mix(points[0], points[1]);
    let b = mix(points[1], points[2]);
    let middle = mix(a, b);
    ([points[0], a, middle], [middle, b, points[2]])
}

fn conic_interval(conic: &Conic, start: f64, end: f64) -> Conic {
    let weight = conic.weight_millionths as f64 / 1_000_000.0;
    let original = [
        HomogeneousPoint {
            x: conic.start.x_nm as f64,
            y: conic.start.y_nm as f64,
            weight: 1.0,
        },
        HomogeneousPoint {
            x: conic.control.x_nm as f64 * weight,
            y: conic.control.y_nm as f64 * weight,
            weight,
        },
        HomogeneousPoint {
            x: conic.end.x_nm as f64,
            y: conic.end.y_nm as f64,
            weight: 1.0,
        },
    ];
    let (left, _) = split_homogeneous(original, end);
    let local = if end <= f64::EPSILON {
        0.0
    } else {
        start / end
    };
    let (_, interval) = split_homogeneous(left, local);
    let point =
        |value: HomogeneousPoint| round_point(value.x / value.weight, value.y / value.weight);
    let normalized_weight = interval[1].weight / (interval[0].weight * interval[2].weight).sqrt();
    Conic {
        start: point(interval[0]),
        control: point(interval[1]),
        end: point(interval[2]),
        weight_millionths: (normalized_weight * 1_000_000.0).round().max(1.0) as i64,
    }
}

/// Durable plane-local offset. Analytic primitive offsets stay primitive and
/// carry a conservative maximum-error bound. Regular polynomial splines and
/// affine ellipses are adaptively represented by line spans only after a
/// derivative bound proves the entire parallel-curve interval is within the
/// caller's model-space tolerance. Unsupported rational/non-Bezier forms are
/// refused rather than assigning a sampled residual the meaning of a proof.
pub fn offset_curve(
    geometry: &Geometry,
    distance_nm: i64,
) -> Result<Vec<Geometry>, OffsetCurveError> {
    offset_curve_with_intervals(geometry, distance_nm)
        .map(|pieces| pieces.into_iter().map(|piece| piece.geometry).collect())
}

pub fn offset_curve_with_intervals(
    geometry: &Geometry,
    distance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    offset_curve_with_tolerance(geometry, distance_nm, OFFSET_MODEL_TOLERANCE_NM)
}

pub fn offset_curve_with_tolerance(
    geometry: &Geometry,
    distance_nm: i64,
    tolerance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    OFFSET_GENERATOR_CALLS.with(|calls| calls.set(calls.get().saturating_add(1)));
    if tolerance_nm <= 0 {
        return Err(tolerance_unattainable(tolerance_nm));
    }
    let whole = |geometry, error_bound_nm: f64| {
        vec![OffsetCurvePiece {
            geometry,
            source_start: 0.0,
            source_end: 1.0,
            certified: true,
            error_bound_nm,
        }]
    };
    let pieces = match geometry {
        Geometry::Line(value) => {
            let dx = (value.end.x_nm as i128 - value.start.x_nm as i128) as f64;
            let dy = (value.end.y_nm as i128 - value.start.y_nm as i128) as f64;
            let length = dx.hypot(dy);
            if !length.is_finite() || length <= 0.0 {
                return Err(OffsetCurveError::SingularOffset);
            }
            let offset_x = checked_rounded_i64(-dy / length * distance_nm as f64)
                .ok_or(OffsetCurveError::SingularOffset)?;
            let offset_y = checked_rounded_i64(dx / length * distance_nm as f64)
                .ok_or(OffsetCurveError::SingularOffset)?;
            // Each rounded translation coordinate contributes at most 0.5 nm.
            // The additional term conservatively covers the IEEE-754
            // normalization/multiplication error at very large distances.
            let error_bound_nm = 1.0 + 32.0 * f64::EPSILON * (distance_nm as f64).abs().max(1.0);
            if error_bound_nm > tolerance_nm as f64 {
                return Err(tolerance_unattainable(tolerance_nm));
            }
            whole(
                Geometry::Line(Line {
                    start: Point2::new(
                        value
                            .start
                            .x_nm
                            .checked_add(offset_x)
                            .ok_or(OffsetCurveError::SingularOffset)?,
                        value
                            .start
                            .y_nm
                            .checked_add(offset_y)
                            .ok_or(OffsetCurveError::SingularOffset)?,
                    ),
                    end: Point2::new(
                        value
                            .end
                            .x_nm
                            .checked_add(offset_x)
                            .ok_or(OffsetCurveError::SingularOffset)?,
                        value
                            .end
                            .y_nm
                            .checked_add(offset_y)
                            .ok_or(OffsetCurveError::SingularOffset)?,
                    ),
                }),
                error_bound_nm,
            )
        }
        Geometry::Circle(value) => {
            let radius_nm = value
                .radius_nm
                .checked_add(distance_nm)
                .ok_or(OffsetCurveError::SingularOffset)?;
            if radius_nm <= 0 {
                return Err(OffsetCurveError::SingularOffset);
            }
            whole(
                Geometry::Circle(Circle {
                    center: value.center,
                    radius_nm,
                }),
                0.0,
            )
        }
        Geometry::Arc(value) => {
            let start_delta = point_delta(value.center, value.start);
            let end_delta = point_delta(value.center, value.end);
            let source_radius = start_delta.0.hypot(start_delta.1);
            let target_radius = source_radius + distance_nm as f64;
            if !source_radius.is_finite()
                || !target_radius.is_finite()
                || source_radius <= 0.0
                || target_radius <= 0.0
            {
                return Err(OffsetCurveError::SingularOffset);
            }
            // Below 2^40 nm every integer delta is represented exactly as an
            // f64, while accumulated radial arithmetic error remains well
            // below one nanometer. Reject larger scales rather than falsely
            // attaching a tight model-space certificate.
            const MAX_CERTIFIED_ARC_SCALE_NM: f64 = (1_u64 << 40) as f64;
            let numeric_scale_nm = start_delta
                .0
                .abs()
                .max(start_delta.1.abs())
                .max(end_delta.0.abs())
                .max(end_delta.1.abs())
                .max(target_radius.abs())
                .max((distance_nm as f64).abs())
                .max(1.0);
            if numeric_scale_nm > MAX_CERTIFIED_ARC_SCALE_NM {
                return Err(tolerance_unattainable(tolerance_nm));
            }
            // Two nanometers cover endpoint rounding and source-radius
            // quantization. The scale term conservatively covers the
            // correctly-rounded hypot, division, and multiplication steps.
            let error_bound_nm = 2.0 + 128.0 * f64::EPSILON * numeric_scale_nm;
            if error_bound_nm > tolerance_nm as f64 {
                return Err(tolerance_unattainable(tolerance_nm));
            }
            whole(
                Geometry::Arc(Arc {
                    center: value.center,
                    start: offset_radial(value.center, value.start, target_radius)?,
                    end: offset_radial(value.center, value.end, target_radius)?,
                    clockwise: value.clockwise,
                }),
                error_bound_nm,
            )
        }
        Geometry::Rectangle(value) => {
            let min = Point2::new(
                value
                    .min
                    .x_nm
                    .checked_sub(distance_nm)
                    .ok_or(OffsetCurveError::SingularOffset)?,
                value
                    .min
                    .y_nm
                    .checked_sub(distance_nm)
                    .ok_or(OffsetCurveError::SingularOffset)?,
            );
            let max = Point2::new(
                value
                    .max
                    .x_nm
                    .checked_add(distance_nm)
                    .ok_or(OffsetCurveError::SingularOffset)?,
                value
                    .max
                    .y_nm
                    .checked_add(distance_nm)
                    .ok_or(OffsetCurveError::SingularOffset)?,
            );
            if min.x_nm >= max.x_nm || min.y_nm >= max.y_nm {
                return Err(OffsetCurveError::SingularOffset);
            }
            whole(Geometry::Rectangle(Rectangle { min, max }), 0.0)
        }
        Geometry::ControlPointSpline(value) => {
            certified_control_spline_offset(value, distance_nm, tolerance_nm)?
        }
        Geometry::FitPointSpline(value) => {
            certified_fit_spline_offset(value, distance_nm, tolerance_nm)?
        }
        Geometry::Ellipse(value) => certified_ellipse_offset(value, distance_nm, tolerance_nm)?,
        Geometry::EllipticalArc(value) => {
            certified_elliptical_arc_offset(value, distance_nm, tolerance_nm)?
        }
        Geometry::Conic(value) => certified_conic_offset(value, distance_nm, tolerance_nm)?,
        Geometry::SketchPoint(_) => return Err(OffsetCurveError::SingularOffset),
    };
    debug_assert!(pieces.iter().all(|piece| piece.certified));
    Ok(pieces)
}

#[derive(Clone, Copy, Debug)]
struct FloatPoint {
    x: f64,
    y: f64,
}

impl FloatPoint {
    fn from_model(point: Point2) -> Self {
        Self {
            x: point.x_nm as f64,
            y: point.y_nm as f64,
        }
    }

    fn sub(self, other: Self) -> Self {
        Self {
            x: self.x - other.x,
            y: self.y - other.y,
        }
    }

    fn scale(self, factor: f64) -> Self {
        Self {
            x: self.x * factor,
            y: self.y * factor,
        }
    }

    fn norm(self) -> f64 {
        self.x.hypot(self.y)
    }
}

#[derive(Clone, Debug)]
struct PolynomialOffsetInterval {
    controls: Vec<FloatPoint>,
    source_start: f64,
    source_end: f64,
    depth: u8,
}

fn derivative_controls(points: &[FloatPoint]) -> Vec<FloatPoint> {
    let degree = points.len().saturating_sub(1) as f64;
    points
        .windows(2)
        .map(|window| window[1].sub(window[0]).scale(degree))
        .collect()
}

fn split_polynomial_controls(points: &[FloatPoint]) -> (Vec<FloatPoint>, Vec<FloatPoint>) {
    let mut rows = vec![points.to_vec()];
    while rows.last().is_some_and(|row| row.len() > 1) {
        let row = rows.last().expect("subdivision row");
        rows.push(
            row.windows(2)
                .map(|pair| FloatPoint {
                    x: (pair[0].x + pair[1].x) * 0.5,
                    y: (pair[0].y + pair[1].y) * 0.5,
                })
                .collect(),
        );
    }
    let left = rows.iter().map(|row| row[0]).collect();
    let right = rows.iter().rev().map(|row| row[row.len() - 1]).collect();
    (left, right)
}

fn vector_hull_distance_lower(vectors: &[FloatPoint]) -> f64 {
    if vectors.is_empty() {
        return 0.0;
    }
    let (mut min_x, mut max_x, mut min_y, mut max_y) =
        (vectors[0].x, vectors[0].x, vectors[0].y, vectors[0].y);
    for value in &vectors[1..] {
        min_x = min_x.min(value.x);
        max_x = max_x.max(value.x);
        min_y = min_y.min(value.y);
        max_y = max_y.max(value.y);
    }
    let dx = if min_x > 0.0 {
        min_x
    } else if max_x < 0.0 {
        -max_x
    } else {
        0.0
    };
    let dy = if min_y > 0.0 {
        min_y
    } else if max_y < 0.0 {
        -max_y
    } else {
        0.0
    };
    // The derivative convex hull is contained by this box. Its distance from
    // zero therefore cannot be smaller than the distance to the box.
    dx.hypot(dy) * (1.0 - 32.0 * f64::EPSILON)
}

fn maximum_control_norm(vectors: &[FloatPoint]) -> f64 {
    vectors.iter().map(|value| value.norm()).fold(0.0, f64::max) * (1.0 + 32.0 * f64::EPSILON)
}

fn certified_numeric_allowance(scale_nm: f64) -> Option<f64> {
    // Integer coordinates below 2^40 are exact in binary64. This allowance
    // covers all arithmetic and endpoint rounding performed below. Larger
    // inputs are refused because a tight model-unit proof would require a
    // wider arithmetic implementation.
    const MAX_SCALE_NM: f64 = (1_u64 << 40) as f64;
    (scale_nm.is_finite() && scale_nm <= MAX_SCALE_NM)
        .then_some(4.0 + 4096.0 * f64::EPSILON * scale_nm.max(1.0))
}

fn offset_endpoint(
    point: FloatPoint,
    derivative: FloatPoint,
    distance_nm: i64,
) -> Result<Point2, OffsetCurveError> {
    let speed = derivative.norm();
    if !speed.is_finite() || speed <= 0.0 {
        return Err(OffsetCurveError::SingularOffset);
    }
    let distance = distance_nm as f64;
    let x = point.x - derivative.y / speed * distance;
    let y = point.y + derivative.x / speed * distance;
    Ok(Point2::new(
        checked_rounded_i64(x).ok_or(OffsetCurveError::SingularOffset)?,
        checked_rounded_i64(y).ok_or(OffsetCurveError::SingularOffset)?,
    ))
}

fn polynomial_parallel_error_bound(
    controls: &[FloatPoint],
    distance_nm: i64,
    numeric_allowance_nm: f64,
) -> Option<f64> {
    let first = derivative_controls(controls);
    let second = derivative_controls(&first);
    let third = derivative_controls(&second);
    let speed_lower = vector_hull_distance_lower(&first);
    if !speed_lower.is_finite() || speed_lower <= 0.0 {
        return None;
    }
    let acceleration = maximum_control_norm(&second);
    let jerk = maximum_control_norm(&third);
    // Quotient-rule majorants for T=C'/|C'|.  The deliberately loose 2/5
    // constants retain every absolute-value term (including derivatives of
    // 1/|C'|), so this remains a proof when vector cancellations disappear.
    // The linear-interpolation remainder of a twice differentiable vector
    // function is bounded by max ||f''|| / 8 over the unit interval.
    let normal_second =
        2.0 * jerk / speed_lower + 5.0 * acceleration * acceleration / (speed_lower * speed_lower);
    let bound =
        (acceleration + (distance_nm as f64).abs() * normal_second) / 8.0 + numeric_allowance_nm;
    bound.is_finite().then_some(bound)
}

fn polynomial_parallel_quadratic_error_bound(
    controls: &[FloatPoint],
    distance_nm: i64,
    numeric_allowance_nm: f64,
) -> Option<f64> {
    let first = derivative_controls(controls);
    let second = derivative_controls(&first);
    let third = derivative_controls(&second);
    let fourth = derivative_controls(&third);
    let speed = vector_hull_distance_lower(&first);
    if !speed.is_finite() || speed <= 0.0 {
        return None;
    }
    let acceleration = maximum_control_norm(&second);
    let jerk = maximum_control_norm(&third);
    let snap = maximum_control_norm(&fourth);
    // Repeated quotient-rule differentiation, retaining absolute values for
    // all terms, gives the conservative 2/18/33 majorant below.
    let normal_third = 2.0 * snap / speed
        + 18.0 * acceleration * jerk / (speed * speed)
        + 33.0 * acceleration.powi(3) / speed.powi(3);
    // Quadratic interpolation at 0, 1/2, 1 has scalar remainder
    // f'''(xi)u(u-1/2)(u-1)/6. 0.012 also covers independent component xi.
    let bound = 0.012 * (jerk + (distance_nm as f64).abs() * normal_third) + numeric_allowance_nm;
    bound.is_finite().then_some(bound)
}

fn polynomial_point_and_derivative(
    controls: &[FloatPoint],
    parameter: f64,
) -> (FloatPoint, FloatPoint) {
    let mut points = controls.to_vec();
    while points.len() > 1 {
        points = points
            .windows(2)
            .map(|pair| FloatPoint {
                x: pair[0].x + (pair[1].x - pair[0].x) * parameter,
                y: pair[0].y + (pair[1].y - pair[0].y) * parameter,
            })
            .collect();
    }
    let derivative_controls = derivative_controls(controls);
    let mut derivatives = derivative_controls;
    while derivatives.len() > 1 {
        derivatives = derivatives
            .windows(2)
            .map(|pair| FloatPoint {
                x: pair[0].x + (pair[1].x - pair[0].x) * parameter,
                y: pair[0].y + (pair[1].y - pair[0].y) * parameter,
            })
            .collect();
    }
    (points[0], derivatives[0])
}

fn quadratic_offset_geometry(
    controls: &[FloatPoint],
    distance_nm: i64,
) -> Result<Geometry, OffsetCurveError> {
    let (p0, v0) = polynomial_point_and_derivative(controls, 0.0);
    let (pm, vm) = polynomial_point_and_derivative(controls, 0.5);
    let (p1, v1) = polynomial_point_and_derivative(controls, 1.0);
    let q0 = offset_endpoint(p0, v0, distance_nm)?;
    let qm = offset_endpoint(pm, vm, distance_nm)?;
    let q2 = offset_endpoint(p1, v1, distance_nm)?;
    let control_x = 2.0 * qm.x_nm as f64 - 0.5 * (q0.x_nm as f64 + q2.x_nm as f64);
    let control_y = 2.0 * qm.y_nm as f64 - 0.5 * (q0.y_nm as f64 + q2.y_nm as f64);
    let q1 = Point2::new(
        checked_rounded_i64(control_x).ok_or(OffsetCurveError::SingularOffset)?,
        checked_rounded_i64(control_y).ok_or(OffsetCurveError::SingularOffset)?,
    );
    Ok(Geometry::ControlPointSpline(ControlPointSpline {
        degree: 2,
        control_points: vec![q0, q1, q2],
        knots_millionths: vec![0, 0, 0, 1_000_000, 1_000_000, 1_000_000],
    }))
}

fn certify_polynomial_intervals(
    seeds: Vec<PolynomialOffsetInterval>,
    distance_nm: i64,
    tolerance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    let scale = seeds
        .iter()
        .flat_map(|seed| &seed.controls)
        .map(|point| point.x.abs().max(point.y.abs()))
        .fold((distance_nm as f64).abs(), f64::max);
    let numeric =
        certified_numeric_allowance(scale).ok_or_else(|| tolerance_unattainable(tolerance_nm))?;
    let mut pending = seeds;
    pending.reverse();
    let mut output = Vec::new();
    let mut visited = 0_usize;
    while let Some(interval) = pending.pop() {
        visited = visited.saturating_add(1);
        if visited > MAX_CERTIFICATION_NODES {
            return Err(tolerance_unattainable(tolerance_nm));
        }
        let quadratic_bound =
            polynomial_parallel_quadratic_error_bound(&interval.controls, distance_nm, numeric);
        if let Some(error_bound_nm) = quadratic_bound.filter(|bound| *bound <= tolerance_nm as f64)
        {
            output.push(OffsetCurvePiece {
                geometry: quadratic_offset_geometry(&interval.controls, distance_nm)?,
                source_start: interval.source_start,
                source_end: interval.source_end,
                certified: true,
                error_bound_nm,
            });
            if output.len() > MAX_OFFSET_SPANS_PER_SOURCE_SIDE {
                return Err(tolerance_unattainable(tolerance_nm));
            }
            continue;
        }
        let line_bound = polynomial_parallel_error_bound(&interval.controls, distance_nm, numeric);
        if let Some(error_bound_nm) = line_bound.filter(|bound| *bound <= tolerance_nm as f64) {
            let derivative = derivative_controls(&interval.controls);
            let start = offset_endpoint(interval.controls[0], derivative[0], distance_nm)?;
            let end = offset_endpoint(
                *interval.controls.last().expect("polynomial endpoint"),
                *derivative.last().expect("polynomial endpoint derivative"),
                distance_nm,
            )?;
            if start == end {
                return Err(OffsetCurveError::SingularOffset);
            }
            output.push(OffsetCurvePiece {
                geometry: Geometry::Line(Line { start, end }),
                source_start: interval.source_start,
                source_end: interval.source_end,
                certified: true,
                error_bound_nm,
            });
            if output.len() > MAX_OFFSET_SPANS_PER_SOURCE_SIDE {
                return Err(tolerance_unattainable(tolerance_nm));
            }
            continue;
        }
        if interval.depth >= MAX_CERT_DEPTH {
            return Err(tolerance_unattainable(tolerance_nm));
        }
        let (left, right) = split_polynomial_controls(&interval.controls);
        let middle = (interval.source_start + interval.source_end) * 0.5;
        pending.push(PolynomialOffsetInterval {
            controls: right,
            source_start: middle,
            source_end: interval.source_end,
            depth: interval.depth + 1,
        });
        pending.push(PolynomialOffsetInterval {
            controls: left,
            source_start: interval.source_start,
            source_end: middle,
            depth: interval.depth + 1,
        });
    }
    Ok(output)
}

fn certified_control_spline_offset(
    spline: &ControlPointSpline,
    distance_nm: i64,
    tolerance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    let degree = usize::from(spline.degree);
    if !(1..=3).contains(&degree) || spline.control_points.len() != degree + 1 {
        return Err(tolerance_unattainable(tolerance_nm));
    }
    let clamped = spline.knots_millionths.is_empty()
        || (spline.knots_millionths.len() == 2 * (degree + 1)
            && spline.knots_millionths[..=degree]
                .iter()
                .all(|knot| *knot == 0)
            && spline.knots_millionths[degree + 1..]
                .iter()
                .all(|knot| *knot == 1_000_000));
    if !clamped {
        return Err(tolerance_unattainable(tolerance_nm));
    }
    certify_polynomial_intervals(
        vec![PolynomialOffsetInterval {
            controls: spline
                .control_points
                .iter()
                .copied()
                .map(FloatPoint::from_model)
                .collect(),
            source_start: 0.0,
            source_end: 1.0,
            depth: 0,
        }],
        distance_nm,
        tolerance_nm,
    )
}

fn certified_fit_spline_offset(
    spline: &FitPointSpline,
    distance_nm: i64,
    tolerance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    if spline.fit_points.len() < 2
        || spline.fit_points.len().saturating_sub(1) > MAX_OFFSET_SPANS_PER_SOURCE_SIDE
    {
        return Err(tolerance_unattainable(tolerance_nm));
    }
    let segments = spline.fit_points.len() - 1;
    let seeds = (0..segments)
        .map(|index| {
            let p0 = spline.fit_points[index.saturating_sub(1)];
            let p1 = spline.fit_points[index];
            let p2 = spline.fit_points[index + 1];
            let p3 = spline.fit_points[(index + 2).min(segments)];
            let p0 = FloatPoint::from_model(p0);
            let p1 = FloatPoint::from_model(p1);
            let p2 = FloatPoint::from_model(p2);
            let p3 = FloatPoint::from_model(p3);
            PolynomialOffsetInterval {
                controls: vec![
                    p1,
                    FloatPoint {
                        x: p1.x + (p2.x - p0.x) / 6.0,
                        y: p1.y + (p2.y - p0.y) / 6.0,
                    },
                    FloatPoint {
                        x: p2.x - (p3.x - p1.x) / 6.0,
                        y: p2.y - (p3.y - p1.y) / 6.0,
                    },
                    p2,
                ],
                source_start: index as f64 / segments as f64,
                source_end: (index + 1) as f64 / segments as f64,
                depth: 0,
            }
        })
        .collect();
    certify_polynomial_intervals(seeds, distance_nm, tolerance_nm)
}

fn certified_conic_offset(
    conic: &Conic,
    distance_nm: i64,
    tolerance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    // Weight one is exactly a polynomial quadratic Bezier. Other rational
    // weights remain conservatively refused until homogeneous derivative
    // interval bounds are part of the durable evaluator.
    if conic.weight_millionths != 1_000_000 {
        return Err(tolerance_unattainable(tolerance_nm));
    }
    certify_polynomial_intervals(
        vec![PolynomialOffsetInterval {
            controls: [conic.start, conic.control, conic.end]
                .map(FloatPoint::from_model)
                .to_vec(),
            source_start: 0.0,
            source_end: 1.0,
            depth: 0,
        }],
        distance_nm,
        tolerance_nm,
    )
}

#[derive(Clone, Copy)]
struct EllipseOffsetInterval {
    center: FloatPoint,
    axis_a: FloatPoint,
    axis_b: FloatPoint,
    angle_start: f64,
    angle_end: f64,
    source_start: f64,
    source_end: f64,
    depth: u8,
}

fn ellipse_interval_endpoint(
    interval: EllipseOffsetInterval,
    at_end: bool,
    distance_nm: i64,
) -> Result<Point2, OffsetCurveError> {
    checked_model_point(
        ellipse_parallel_frame(interval, if at_end { 1.0 } else { 0.0 }, distance_nm)?.0,
    )
}

fn ellipse_parallel_frame(
    interval: EllipseOffsetInterval,
    fraction: f64,
    distance_nm: i64,
) -> Result<(FloatPoint, FloatPoint), OffsetCurveError> {
    let theta = interval.angle_start + (interval.angle_end - interval.angle_start) * fraction;
    let rate = interval.angle_end - interval.angle_start;
    let point = FloatPoint {
        x: interval.center.x + interval.axis_a.x * theta.cos() + interval.axis_b.x * theta.sin(),
        y: interval.center.y + interval.axis_a.y * theta.cos() + interval.axis_b.y * theta.sin(),
    };
    let first = FloatPoint {
        x: rate * (-interval.axis_a.x * theta.sin() + interval.axis_b.x * theta.cos()),
        y: rate * (-interval.axis_a.y * theta.sin() + interval.axis_b.y * theta.cos()),
    };
    let second = FloatPoint {
        x: rate * rate * (-interval.axis_a.x * theta.cos() - interval.axis_b.x * theta.sin()),
        y: rate * rate * (-interval.axis_a.y * theta.cos() - interval.axis_b.y * theta.sin()),
    };
    let speed = first.norm();
    if !speed.is_finite() || speed <= 0.0 {
        return Err(OffsetCurveError::SingularOffset);
    }
    let dot = first.x * second.x + first.y * second.y;
    let tangent_derivative = FloatPoint {
        x: second.x / speed - first.x * dot / speed.powi(3),
        y: second.y / speed - first.y * dot / speed.powi(3),
    };
    let distance = distance_nm as f64;
    let offset = FloatPoint {
        x: point.x - first.y / speed * distance,
        y: point.y + first.x / speed * distance,
    };
    let offset_derivative = FloatPoint {
        x: first.x - tangent_derivative.y * distance,
        y: first.y + tangent_derivative.x * distance,
    };
    if !offset.x.is_finite()
        || !offset.y.is_finite()
        || !offset_derivative.x.is_finite()
        || !offset_derivative.y.is_finite()
    {
        return Err(OffsetCurveError::SingularOffset);
    }
    Ok((offset, offset_derivative))
}

fn checked_model_point(point: FloatPoint) -> Result<Point2, OffsetCurveError> {
    Ok(Point2::new(
        checked_rounded_i64(point.x).ok_or(OffsetCurveError::SingularOffset)?,
        checked_rounded_i64(point.y).ok_or(OffsetCurveError::SingularOffset)?,
    ))
}

fn ellipse_cubic_hermite_geometry(
    interval: EllipseOffsetInterval,
    distance_nm: i64,
) -> Result<Geometry, OffsetCurveError> {
    let (start, start_derivative) = ellipse_parallel_frame(interval, 0.0, distance_nm)?;
    let (end, end_derivative) = ellipse_parallel_frame(interval, 1.0, distance_nm)?;
    let q0 = checked_model_point(start)?;
    let q1 = checked_model_point(FloatPoint {
        x: start.x + start_derivative.x / 3.0,
        y: start.y + start_derivative.y / 3.0,
    })?;
    let q2 = checked_model_point(FloatPoint {
        x: end.x - end_derivative.x / 3.0,
        y: end.y - end_derivative.y / 3.0,
    })?;
    let q3 = checked_model_point(end)?;
    Ok(Geometry::ControlPointSpline(ControlPointSpline {
        degree: 3,
        control_points: vec![q0, q1, q2, q3],
        knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
    }))
}

fn normalized_fourth_derivative_bound(
    speed_lower: f64,
    velocity_derivatives: [f64; 5],
    speed_squared_derivatives: [f64; 4],
) -> Option<f64> {
    let [v0, v1, v2, v3, v4] = velocity_derivatives;
    let [g1, g2, g3, g4] = speed_squared_derivatives;
    if !speed_lower.is_finite() || speed_lower <= 0.0 {
        return None;
    }
    let m = speed_lower;
    // q=(v·v)^(-1/2); explicit Faà di Bruno majorants avoid relying on
    // sampled curvature extrema.
    let q0 = 1.0 / m;
    // These are derivatives of x^-1/2 with x=|v|^2, hence powers of
    // m^3, m^5, m^7, and m^9 respectively.
    let f1 = 0.5 / m.powi(3);
    let f2 = 0.75 / m.powi(5);
    let f3 = 1.875 / m.powi(7);
    let f4 = 6.5625 / m.powi(9);
    let q1 = f1 * g1;
    let q2 = f2 * g1.powi(2) + f1 * g2;
    let q3 = f3 * g1.powi(3) + 3.0 * f2 * g1 * g2 + f1 * g3;
    let q4 = f4 * g1.powi(4)
        + 6.0 * f3 * g1.powi(2) * g2
        + 3.0 * f2 * g2.powi(2)
        + 4.0 * f2 * g1 * g3
        + f1 * g4;
    let bound = v4 * q0 + 4.0 * v3 * q1 + 6.0 * v2 * q2 + 4.0 * v1 * q3 + v0 * q4;
    bound.is_finite().then_some(bound)
}

fn certify_ellipse_intervals(
    mut pending: Vec<EllipseOffsetInterval>,
    distance_nm: i64,
    tolerance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    let scale = pending
        .iter()
        .flat_map(|value| [value.center, value.axis_a, value.axis_b])
        .map(|point| point.x.abs().max(point.y.abs()))
        .fold((distance_nm as f64).abs(), f64::max);
    let numeric =
        certified_numeric_allowance(scale).ok_or_else(|| tolerance_unattainable(tolerance_nm))?;
    pending.reverse();
    let mut output = Vec::new();
    let mut visited = 0_usize;
    while let Some(interval) = pending.pop() {
        visited = visited.saturating_add(1);
        if visited > MAX_CERTIFICATION_NODES {
            return Err(tolerance_unattainable(tolerance_nm));
        }
        let ax = interval.axis_a.x;
        let ay = interval.axis_a.y;
        let bx = interval.axis_b.x;
        let by = interval.axis_b.y;
        let determinant = ax * by - ay * bx;
        let frobenius = ax.hypot(ay).hypot(bx.hypot(by)) * (1.0 + 32.0 * f64::EPSILON);
        let span = (interval.angle_end - interval.angle_start).abs();
        let axis_speed_lower =
            determinant.abs() / frobenius.max(f64::MIN_POSITIVE) * (1.0 - 64.0 * f64::EPSILON);
        let speed_lower = axis_speed_lower * span;
        let acceleration = frobenius * span * span;
        let jerk = frobenius * span * span * span;
        let snap = frobenius * span.powi(4);
        let normal_second = 2.0 * jerk / speed_lower
            + 5.0 * acceleration * acceleration / (speed_lower * speed_lower);
        let line_error_bound_nm =
            (acceleration + (distance_nm as f64).abs() * normal_second) / 8.0 + numeric;
        // |C'|² is exactly a second harmonic. Its derivative amplitudes
        // follow from the axis Gram matrix, which is substantially tighter
        // than multiplying independent velocity bounds and remains analytic.
        let aa = ax * ax + ay * ay;
        let bb = bx * bx + by * by;
        let ab = ax * bx + ay * by;
        let speed_squared_harmonic = ((bb - aa) * 0.5).hypot(ab);
        let speed_squared_derivatives = [1_i32, 2, 3, 4].map(|order| {
            speed_squared_harmonic * (2.0 * span).powi(order) * (1.0 + 64.0 * f64::EPSILON)
        });
        let normal_fourth = normalized_fourth_derivative_bound(
            axis_speed_lower,
            [frobenius, frobenius * span, acceleration, jerk, snap],
            speed_squared_derivatives,
        );
        // Cubic Hermite interpolation has remainder
        // f''''(ξ)u²(1-u)²/4!.  0.0037 exceeds sqrt(2)/384, so it
        // also bounds a vector-valued curve when component remainders attain
        // their extrema at different parameters.
        let cubic_error_bound_nm = normal_fourth.map(|normal_fourth| {
            0.0037 * (snap + (distance_nm as f64).abs() * normal_fourth) + numeric
        });
        if speed_lower.is_finite()
            && speed_lower > 0.0
            && cubic_error_bound_nm
                .is_some_and(|bound| bound.is_finite() && bound <= tolerance_nm as f64)
        {
            let error_bound_nm = cubic_error_bound_nm.expect("checked cubic error bound");
            output.push(OffsetCurvePiece {
                geometry: ellipse_cubic_hermite_geometry(interval, distance_nm)?,
                source_start: interval.source_start,
                source_end: interval.source_end,
                certified: true,
                error_bound_nm,
            });
            if output.len() > MAX_OFFSET_SPANS_PER_SOURCE_SIDE {
                return Err(tolerance_unattainable(tolerance_nm));
            }
            continue;
        }
        if speed_lower.is_finite()
            && speed_lower > 0.0
            && line_error_bound_nm.is_finite()
            && line_error_bound_nm <= tolerance_nm as f64
        {
            let start = ellipse_interval_endpoint(interval, false, distance_nm)?;
            let end = ellipse_interval_endpoint(interval, true, distance_nm)?;
            if start == end {
                return Err(OffsetCurveError::SingularOffset);
            }
            output.push(OffsetCurvePiece {
                geometry: Geometry::Line(Line { start, end }),
                source_start: interval.source_start,
                source_end: interval.source_end,
                certified: true,
                error_bound_nm: line_error_bound_nm,
            });
            if output.len() > MAX_OFFSET_SPANS_PER_SOURCE_SIDE {
                return Err(tolerance_unattainable(tolerance_nm));
            }
            continue;
        }
        if interval.depth >= MAX_CERT_DEPTH {
            return Err(tolerance_unattainable(tolerance_nm));
        }
        let angle_middle = (interval.angle_start + interval.angle_end) * 0.5;
        let source_middle = (interval.source_start + interval.source_end) * 0.5;
        pending.push(EllipseOffsetInterval {
            angle_start: angle_middle,
            source_start: source_middle,
            depth: interval.depth + 1,
            ..interval
        });
        pending.push(EllipseOffsetInterval {
            angle_end: angle_middle,
            source_end: source_middle,
            depth: interval.depth + 1,
            ..interval
        });
    }
    consolidate_certified_cubic_spans(output, tolerance_nm)
}

fn consolidate_certified_cubic_spans(
    pieces: Vec<OffsetCurvePiece>,
    tolerance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    if pieces.len() <= 1 {
        return Ok(pieces);
    }
    let mut controls = Vec::with_capacity(pieces.len() * 3 + 1);
    let mut knots = vec![0_u32; 4];
    let mut certified_error_nm = 0.0_f64;
    for (index, piece) in pieces.iter().enumerate() {
        let Geometry::ControlPointSpline(spline) = &piece.geometry else {
            return Ok(pieces);
        };
        if spline.degree != 3 || spline.control_points.len() != 4 {
            return Ok(pieces);
        }
        if index == 0 {
            controls.extend_from_slice(&spline.control_points);
        } else {
            controls.extend_from_slice(&spline.control_points[1..]);
        }
        certified_error_nm = certified_error_nm.max(piece.error_bound_nm);
        if index + 1 < pieces.len() {
            let knot = ((piece.source_end * 1_000_000.0).round() as u32).clamp(1, 999_999);
            knots.extend([knot; 3]);
        }
    }
    knots.extend([1_000_000; 4]);
    if certified_error_nm > tolerance_nm as f64 {
        return Err(tolerance_unattainable(tolerance_nm));
    }
    Ok(vec![OffsetCurvePiece {
        geometry: Geometry::ControlPointSpline(ControlPointSpline {
            degree: 3,
            control_points: controls,
            knots_millionths: knots,
        }),
        source_start: 0.0,
        source_end: 1.0,
        certified: true,
        error_bound_nm: certified_error_nm,
    }])
}

fn ellipse_seed_intervals(
    center: Point2,
    major: Point2,
    minor: Point2,
    angle_start: f64,
    angle_end: f64,
) -> Vec<EllipseOffsetInterval> {
    let center_float = FloatPoint::from_model(center);
    let axis_a = FloatPoint::from_model(major).sub(center_float);
    let axis_b = FloatPoint::from_model(minor).sub(center_float);
    let sweep = angle_end - angle_start;
    let seed_count = ((sweep.abs() / (std::f64::consts::PI / 4.0)).ceil() as usize).max(1);
    (0..seed_count)
        .map(|index| EllipseOffsetInterval {
            center: center_float,
            axis_a,
            axis_b,
            angle_start: angle_start + sweep * index as f64 / seed_count as f64,
            angle_end: angle_start + sweep * (index + 1) as f64 / seed_count as f64,
            source_start: index as f64 / seed_count as f64,
            source_end: (index + 1) as f64 / seed_count as f64,
            depth: 0,
        })
        .collect()
}

fn certified_ellipse_offset(
    ellipse: &Ellipse,
    distance_nm: i64,
    tolerance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    certify_ellipse_intervals(
        ellipse_seed_intervals(
            ellipse.center,
            ellipse.major,
            ellipse.minor,
            0.0,
            std::f64::consts::TAU,
        ),
        distance_nm,
        tolerance_nm,
    )
}

fn certified_elliptical_arc_offset(
    arc: &EllipticalArc,
    distance_nm: i64,
    tolerance_nm: i64,
) -> Result<Vec<OffsetCurvePiece>, OffsetCurveError> {
    let start = ellipse_angle(arc.center, arc.major, arc.minor, arc.start);
    let mut end = ellipse_angle(arc.center, arc.major, arc.minor, arc.end);
    if arc.clockwise {
        while end >= start {
            end -= std::f64::consts::TAU;
        }
    } else {
        while end <= start {
            end += std::f64::consts::TAU;
        }
    }
    certify_ellipse_intervals(
        ellipse_seed_intervals(arc.center, arc.major, arc.minor, start, end),
        distance_nm,
        tolerance_nm,
    )
}

fn tolerance_unattainable(tolerance_nm: i64) -> OffsetCurveError {
    OffsetCurveError::OffsetToleranceUnattainable {
        tolerance_nm,
        max_spans: MAX_OFFSET_SPANS_PER_SOURCE_SIDE,
        max_nodes: MAX_CERTIFICATION_NODES,
        max_depth: MAX_CERT_DEPTH,
    }
}

fn point_delta(center: Point2, point: Point2) -> (f64, f64) {
    (
        (point.x_nm as i128 - center.x_nm as i128) as f64,
        (point.y_nm as i128 - center.y_nm as i128) as f64,
    )
}

fn checked_rounded_i64(value: f64) -> Option<i64> {
    let rounded = value.round();
    let exclusive_max = -(i64::MIN as f64);
    (rounded.is_finite() && rounded >= i64::MIN as f64 && rounded < exclusive_max)
        .then_some(rounded as i64)
}

fn offset_radial(center: Point2, point: Point2, radius: f64) -> Result<Point2, OffsetCurveError> {
    let (dx, dy) = point_delta(center, point);
    let length = dx.hypot(dy);
    if !length.is_finite() || length <= 0.0 || !radius.is_finite() {
        return Err(OffsetCurveError::SingularOffset);
    }
    let radial_x =
        checked_rounded_i64(dx * radius / length).ok_or(OffsetCurveError::SingularOffset)?;
    let radial_y =
        checked_rounded_i64(dy * radius / length).ok_or(OffsetCurveError::SingularOffset)?;
    Ok(Point2::new(
        center
            .x_nm
            .checked_add(radial_x)
            .ok_or(OffsetCurveError::SingularOffset)?,
        center
            .y_nm
            .checked_add(radial_y)
            .ok_or(OffsetCurveError::SingularOffset)?,
    ))
}

pub fn evaluate_frame(geometry: &Geometry, parameter: f64) -> CurveFrame {
    let t = parameter.clamp(0.0, 1.0);
    // Production sketches are millimeter-scale nanometer coordinates and can
    // use a tight derivative stencil. Tiny fixtures need a wider stencil so
    // integer-nanometer evaluation remains observable.
    // Derivative stencil selection needs only a scale estimate. Calling the
    // tolerance-bounded tessellator here would recursively re-bound a curve
    // for every frame evaluation used by offset, projection, and solving.
    let diagonal = geometry_scale_nm(geometry);
    let h = if diagonal >= 100_000.0 {
        1.0e-4
    } else {
        1.0 / 32.0
    };
    let left = evaluate_curve(geometry, (t - h).max(0.0));
    let point = evaluate_curve(geometry, t);
    let right = evaluate_curve(geometry, (t + h).min(1.0));
    let dx = (right.x_nm - left.x_nm) as f64;
    let dy = (right.y_nm - left.y_nm) as f64;
    let magnitude = dx.hypot(dy).max(1.0);
    let ddx = (right.x_nm - 2 * point.x_nm + left.x_nm) as f64;
    let ddy = (right.y_nm - 2 * point.y_nm + left.y_nm) as f64;
    CurveFrame {
        point,
        tangent: [dx / magnitude, dy / magnitude],
        curvature_per_nm: (dx * ddy - dy * ddx) / magnitude.powi(3),
    }
}

pub(crate) fn geometry_scale_nm(geometry: &Geometry) -> f64 {
    let points: Vec<Point2> = match geometry {
        Geometry::Line(value) => vec![value.start, value.end],
        Geometry::Circle(value) => return value.radius_nm.abs() as f64 * 2.0,
        Geometry::Arc(value) => return distance(value.center, value.start) * 2.0,
        Geometry::Rectangle(value) => vec![value.min, value.max],
        Geometry::ControlPointSpline(value) => value.control_points.clone(),
        Geometry::FitPointSpline(value) => value.fit_points.clone(),
        Geometry::Ellipse(value) => {
            return distance(value.center, value.major).max(distance(value.center, value.minor))
                * 2.0;
        }
        Geometry::EllipticalArc(value) => {
            return distance(value.center, value.major).max(distance(value.center, value.minor))
                * 2.0;
        }
        Geometry::Conic(value) => vec![value.start, value.control, value.end],
        Geometry::SketchPoint(value) => vec![*value],
    };
    let Some(first) = points.first() else {
        return 0.0;
    };
    let (mut min_x, mut max_x, mut min_y, mut max_y) =
        (first.x_nm, first.x_nm, first.y_nm, first.y_nm);
    for point in &points[1..] {
        min_x = min_x.min(point.x_nm);
        max_x = max_x.max(point.x_nm);
        min_y = min_y.min(point.y_nm);
        max_y = max_y.max(point.y_nm);
    }
    (max_x - min_x).abs() as f64 + (max_y - min_y).abs() as f64
}

pub fn project_point(geometry: &Geometry, target: Point2) -> CurveProjection {
    let squared = |t: f64| {
        let point = evaluate_curve(geometry, t);
        let dx = (point.x_nm - target.x_nm) as f64;
        let dy = (point.y_nm - target.y_nm) as f64;
        dx * dx + dy * dy
    };
    // Spatial chord certification does not make the parameterization
    // unimodal: a collinear spline can reverse several times inside one finite
    // chord. Globally branch parameter intervals instead. Each interval lower
    // bound is the target-to-chord distance minus the conservative Hausdorff
    // bound, so termination proves the reported additive error.
    let chord_projection = |a: Point2, b: Point2| {
        let dx = (b.x_nm - a.x_nm) as f64;
        let dy = (b.y_nm - a.y_nm) as f64;
        let denominator = dx * dx + dy * dy;
        let u = if denominator <= f64::EPSILON {
            0.0
        } else {
            (((target.x_nm - a.x_nm) as f64 * dx + (target.y_nm - a.y_nm) as f64 * dy)
                / denominator)
                .clamp(0.0, 1.0)
        };
        let x = a.x_nm as f64 + dx * u;
        let y = a.y_nm as f64 + dy * u;
        ((x - target.x_nm as f64).hypot(y - target.y_nm as f64), u)
    };
    let interval = |lo: f64, hi: f64| {
        let a = evaluate_curve(geometry, lo);
        let b = evaluate_curve(geometry, hi);
        let (chord_distance, _) = chord_projection(a, b);
        let deviation = curve_interval_deviation_bound(geometry, lo, hi, a, b);
        (lo, hi, a, b, (chord_distance - deviation).max(0.0))
    };
    let cuts = curve_seed_parameters(geometry, 8);
    let mut pending = cuts
        .windows(2)
        .map(|values| interval(values[0], values[1]))
        .collect::<Vec<_>>();
    let mut parameter = 0.0;
    let mut best_squared = squared(0.0);
    let consider = |candidate: f64, parameter: &mut f64, best_squared: &mut f64| {
        let value = squared(candidate);
        if value < *best_squared {
            *best_squared = value;
            *parameter = candidate;
        }
    };
    for &(lo, hi, _, _, _) in &pending {
        consider(lo, &mut parameter, &mut best_squared);
        consider((lo + hi) * 0.5, &mut parameter, &mut best_squared);
        consider(hi, &mut parameter, &mut best_squared);
    }
    let mut global_lower = 0.0;
    while !pending.is_empty() {
        pending.sort_by(|left, right| {
            left.4
                .partial_cmp(&right.4)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let (lo, hi, _, _, lower) = pending.remove(0);
        global_lower = lower;
        if best_squared.sqrt() - lower <= CURVE_APPROXIMATION_TOLERANCE_NM {
            break;
        }
        let middle = (lo + hi) * 0.5;
        if middle == lo || middle == hi {
            break;
        }
        consider(middle, &mut parameter, &mut best_squared);
        pending.push(interval(lo, middle));
        pending.push(interval(middle, hi));
    }
    let frame = evaluate_frame(geometry, parameter);
    let distance_nm = distance(frame.point, target);
    CurveProjection {
        parameter,
        distance_nm,
        frame,
        error_bound_nm: (distance_nm - global_lower).max(0.0) + 1.0,
    }
}

pub fn intersect_curves(
    first: &Geometry,
    second: &Geometry,
    samples: usize,
) -> Vec<CurveIntersection> {
    let seed_segments = (samples.max(8) / 32).clamp(1, 32);
    let a = adaptive_curve_samples(first, seed_segments);
    let b = adaptive_curve_samples(second, seed_segments);
    let mut output = Vec::new();
    for i in 0..a.len() - 1 {
        for j in 0..b.len() - 1 {
            if !segment_bounds_overlap(
                a[i].1,
                a[i + 1].1,
                b[j].1,
                b[j + 1].1,
                CURVE_APPROXIMATION_TOLERANCE_NM * 3.0,
            ) {
                continue;
            }
            let seed = segment_intersection(a[i].1, a[i + 1].1, b[j].1, b[j + 1].1)
                .map(|(_, ta, tb)| (ta, tb))
                .or_else(|| {
                    let (ta, tb, distance) =
                        segment_closest_parameters(a[i].1, a[i + 1].1, b[j].1, b[j + 1].1);
                    // Each adaptive chord is within two nanometers of its
                    // curve, so a six-nanometer chord separation is the
                    // conservative candidate band for tangential contact.
                    (distance <= CURVE_APPROXIMATION_TOLERANCE_NM * 3.0).then_some((ta, tb))
                });
            if let Some((ta, tb)) = seed {
                let first_seed = a[i].0 + (a[i + 1].0 - a[i].0) * ta;
                let second_seed = b[j].0 + (b[j + 1].0 - b[j].0) * tb;
                let (first_parameter, second_parameter) = refine_curve_intersection(
                    first,
                    second,
                    first_seed,
                    second_seed,
                    [a[i].0, a[i + 1].0],
                    [b[j].0, b[j + 1].0],
                );
                let first_point = evaluate_curve(first, first_parameter);
                let second_point = evaluate_curve(second, second_parameter);
                if distance(first_point, second_point) > CURVE_APPROXIMATION_TOLERANCE_NM * 2.0 {
                    continue;
                }
                let point = round_point(
                    (first_point.x_nm as f64 + second_point.x_nm as f64) * 0.5,
                    (first_point.y_nm as f64 + second_point.y_nm as f64) * 0.5,
                );
                let next = CurveIntersection {
                    point,
                    first_parameter,
                    second_parameter,
                };
                if let Some(index) = output.iter().position(|candidate: &CurveIntersection| {
                    same_intersection_candidate(
                        first,
                        second,
                        candidate,
                        point,
                        first_parameter,
                        second_parameter,
                    )
                }) {
                    if intersection_candidate_quality(first, second, &next)
                        < intersection_candidate_quality(first, second, &output[index])
                    {
                        output[index] = next;
                    }
                    continue;
                }
                output.push(next);
            }
        }
    }
    output.sort_by(|left, right| left.first_parameter.total_cmp(&right.first_parameter));
    output
}

fn intersection_candidate_quality(
    first: &Geometry,
    second: &Geometry,
    value: &CurveIntersection,
) -> f64 {
    let a = evaluate_frame(first, value.first_parameter);
    let b = evaluate_frame(second, value.second_parameter);
    let cross = (a.tangent[0] * b.tangent[1] - a.tangent[1] * b.tangent[0]).abs();
    let separation = distance(
        evaluate_curve(first, value.first_parameter),
        evaluate_curve(second, value.second_parameter),
    );
    cross + separation / CURVE_APPROXIMATION_TOLERANCE_NM.max(1.0)
}

fn same_intersection_candidate(
    first: &Geometry,
    second: &Geometry,
    candidate: &CurveIntersection,
    point: Point2,
    first_parameter: f64,
    second_parameter: f64,
) -> bool {
    let separation = distance(candidate.point, point);
    if separation <= CURVE_APPROXIMATION_TOLERANCE_NM * 4.0 {
        return true;
    }
    let first_frame = evaluate_frame(first, first_parameter);
    let second_frame = evaluate_frame(second, second_parameter);
    let tangent_cross = (first_frame.tangent[0] * second_frame.tangent[1]
        - first_frame.tangent[1] * second_frame.tangent[0])
        .abs();
    if tangent_cross > 5.0e-3 {
        return false;
    }
    let curvature = nominal_curvature(first, first_parameter)
        .max(nominal_curvature(second, second_parameter))
        .max(first_frame.curvature_per_nm.abs())
        .max(second_frame.curvature_per_nm.abs());
    if curvature <= f64::EPSILON {
        return false;
    }
    // At a tangent, positional error grows quadratically along the shared
    // tangent. Merge the whole conservative tolerance band into one
    // topological contact rather than reporting neighboring chord endpoints.
    let tangent_band = (8.0 * CURVE_APPROXIMATION_TOLERANCE_NM / curvature).sqrt();
    separation <= tangent_band
        && (candidate.first_parameter - first_parameter).abs() <= 0.01
        && (candidate.second_parameter - second_parameter).abs() <= 0.01
}

fn nominal_curvature(geometry: &Geometry, parameter: f64) -> f64 {
    match geometry {
        Geometry::Circle(value) => 1.0 / value.radius_nm.max(1) as f64,
        Geometry::Arc(value) => 1.0 / distance(value.center, value.start).max(1.0),
        Geometry::Ellipse(value) => ellipse_nominal_curvature(
            value.center,
            value.major,
            value.minor,
            parameter * std::f64::consts::TAU,
        ),
        Geometry::EllipticalArc(value) => {
            let theta = ellipse_angle(
                value.center,
                value.major,
                value.minor,
                evaluate_curve(geometry, parameter),
            );
            ellipse_nominal_curvature(value.center, value.major, value.minor, theta)
        }
        _ => 0.0,
    }
}

fn ellipse_nominal_curvature(center: Point2, major: Point2, minor: Point2, theta: f64) -> f64 {
    let a = distance(center, major).max(1.0);
    let b = distance(center, minor).max(1.0);
    let denominator = (a * a * theta.sin().powi(2) + b * b * theta.cos().powi(2)).powf(1.5);
    a * b / denominator.max(1.0)
}

fn segment_bounds_overlap(a: Point2, b: Point2, c: Point2, d: Point2, margin: f64) -> bool {
    let first_min_x = a.x_nm.min(b.x_nm) as f64 - margin;
    let first_max_x = a.x_nm.max(b.x_nm) as f64 + margin;
    let first_min_y = a.y_nm.min(b.y_nm) as f64 - margin;
    let first_max_y = a.y_nm.max(b.y_nm) as f64 + margin;
    let second_min_x = c.x_nm.min(d.x_nm) as f64;
    let second_max_x = c.x_nm.max(d.x_nm) as f64;
    let second_min_y = c.y_nm.min(d.y_nm) as f64;
    let second_max_y = c.y_nm.max(d.y_nm) as f64;
    first_min_x <= second_max_x
        && first_max_x >= second_min_x
        && first_min_y <= second_max_y
        && first_max_y >= second_min_y
}

fn refine_curve_intersection(
    first: &Geometry,
    second: &Geometry,
    mut a: f64,
    mut b: f64,
    first_interval: [f64; 2],
    second_interval: [f64; 2],
) -> (f64, f64) {
    const H: f64 = 1.0e-5;
    for _ in 0..16 {
        let pa = evaluate_curve(first, a);
        let pb = evaluate_curve(second, b);
        let fa = [(pa.x_nm - pb.x_nm) as f64, (pa.y_nm - pb.y_nm) as f64];
        if fa[0].hypot(fa[1]) <= 0.5 {
            break;
        }
        let a0 = evaluate_curve(first, (a - H).max(0.0));
        let a1 = evaluate_curve(first, (a + H).min(1.0));
        let b0 = evaluate_curve(second, (b - H).max(0.0));
        let b1 = evaluate_curve(second, (b + H).min(1.0));
        let da = [
            a1.x_nm as f64 - a0.x_nm as f64,
            a1.y_nm as f64 - a0.y_nm as f64,
        ];
        let db = [
            b1.x_nm as f64 - b0.x_nm as f64,
            b1.y_nm as f64 - b0.y_nm as f64,
        ];
        let determinant = da[1] * db[0] - da[0] * db[1];
        if determinant.abs() <= 1.0e-9 {
            break;
        }
        let step_a = (fa[0] * db[1] - fa[1] * db[0]) / determinant;
        let step_b = (da[0] * fa[1] - da[1] * fa[0]) / determinant;
        a = (a + step_a * 2.0 * H).clamp(0.0, 1.0);
        b = (b + step_b * 2.0 * H).clamp(0.0, 1.0);
    }
    // A true tangent intersection has a singular Newton Jacobian. Refine the
    // same candidate as a bounded closest-point problem so touching curves are
    // reported with the same tolerance guarantee as transverse crossings.
    let squared = |u: f64, v: f64| {
        let p = evaluate_curve(first, u);
        let q = evaluate_curve(second, v);
        let dx = (p.x_nm - q.x_nm) as f64;
        let dy = (p.y_nm - q.y_nm) as f64;
        dx * dx + dy * dy
    };
    let mut step_a = (first_interval[1] - first_interval[0]).max(1.0e-8) * 0.5;
    let mut step_b = (second_interval[1] - second_interval[0]).max(1.0e-8) * 0.5;
    a = a.clamp(first_interval[0], first_interval[1]);
    b = b.clamp(second_interval[0], second_interval[1]);
    for _ in 0..32 {
        let mut best = (squared(a, b), a, b);
        for da in [-step_a, 0.0, step_a] {
            for db in [-step_b, 0.0, step_b] {
                let candidate_a = (a + da).clamp(first_interval[0], first_interval[1]);
                let candidate_b = (b + db).clamp(second_interval[0], second_interval[1]);
                let candidate = (squared(candidate_a, candidate_b), candidate_a, candidate_b);
                if candidate.0 < best.0 {
                    best = candidate;
                }
            }
        }
        a = best.1;
        b = best.2;
        step_a *= 0.5;
        step_b *= 0.5;
    }
    (a, b)
}

fn segment_closest_parameters(a: Point2, b: Point2, c: Point2, d: Point2) -> (f64, f64, f64) {
    let u = [(b.x_nm - a.x_nm) as f64, (b.y_nm - a.y_nm) as f64];
    let v = [(d.x_nm - c.x_nm) as f64, (d.y_nm - c.y_nm) as f64];
    let w = [(a.x_nm - c.x_nm) as f64, (a.y_nm - c.y_nm) as f64];
    let uu = u[0] * u[0] + u[1] * u[1];
    let uv = u[0] * v[0] + u[1] * v[1];
    let vv = v[0] * v[0] + v[1] * v[1];
    let uw = u[0] * w[0] + u[1] * w[1];
    let vw = v[0] * w[0] + v[1] * w[1];
    let denominator = uu * vv - uv * uv;
    let mut s = if denominator.abs() <= f64::EPSILON {
        0.0
    } else {
        (uv * vw - vv * uw) / denominator
    };
    s = s.clamp(0.0, 1.0);
    let t = if vv <= f64::EPSILON {
        0.0
    } else {
        (uv * s + vw) / vv
    }
    .clamp(0.0, 1.0);
    s = if uu <= f64::EPSILON {
        0.0
    } else {
        (uv * t - uw) / uu
    }
    .clamp(0.0, 1.0);
    let first = round_point(a.x_nm as f64 + u[0] * s, a.y_nm as f64 + u[1] * s);
    let second = round_point(c.x_nm as f64 + v[0] * t, c.y_nm as f64 + v[1] * t);
    (s, t, distance(first, second))
}

fn b_spline(spline: &ControlPointSpline, t: f64) -> Point2 {
    let count = spline.control_points.len();
    if count == 0 {
        return Point2::new(0, 0);
    }
    let degree = usize::from(spline.degree).min(count.saturating_sub(1));
    if degree == 0 {
        return spline.control_points[(t.clamp(0.0, 1.0) * (count - 1) as f64).round() as usize];
    }
    let knots = control_spline_knots(spline);
    let t = t.clamp(0.0, 1.0);
    let span = if t >= 1.0 {
        count - 1
    } else {
        (degree..count)
            .find(|index| t < knots[index + 1])
            .unwrap_or(count - 1)
    };
    let mut work = (0..=degree)
        .map(|index| {
            let point = spline.control_points[span - degree + index];
            [point.x_nm as f64, point.y_nm as f64]
        })
        .collect::<Vec<_>>();
    for level in 1..=degree {
        for index in (level..=degree).rev() {
            let knot_index = span - degree + index;
            let denominator = knots[knot_index + degree - level + 1] - knots[knot_index];
            let alpha = if denominator.abs() <= f64::EPSILON {
                0.0
            } else {
                (t - knots[knot_index]) / denominator
            };
            work[index][0] = (1.0 - alpha) * work[index - 1][0] + alpha * work[index][0];
            work[index][1] = (1.0 - alpha) * work[index - 1][1] + alpha * work[index][1];
        }
    }
    round_point(work[degree][0], work[degree][1])
}

fn open_uniform_knots(control_count: usize, degree: usize) -> Vec<f64> {
    let knot_count = control_count + degree + 1;
    let spans = control_count.saturating_sub(degree).max(1);
    (0..knot_count)
        .map(|index| {
            if index <= degree {
                0.0
            } else if index >= control_count {
                1.0
            } else {
                (index - degree) as f64 / spans as f64
            }
        })
        .collect()
}

pub(crate) fn control_spline_knots(spline: &ControlPointSpline) -> Vec<f64> {
    if spline.knots_millionths.len() == spline.control_points.len() + usize::from(spline.degree) + 1
    {
        spline
            .knots_millionths
            .iter()
            .map(|value| *value as f64 / 1_000_000.0)
            .collect()
    } else {
        open_uniform_knots(spline.control_points.len(), usize::from(spline.degree))
    }
}
fn catmull_rom(points: &[Point2], t: f64) -> Point2 {
    if points.len() < 2 {
        return points.first().copied().unwrap_or(Point2::new(0, 0));
    }
    let scaled = t * (points.len() - 1) as f64;
    let segment = (scaled.floor() as usize).min(points.len() - 2);
    let u = if t >= 1.0 {
        1.0
    } else {
        scaled - segment as f64
    };
    let p0 = points[segment.saturating_sub(1)];
    let p1 = points[segment];
    let p2 = points[segment + 1];
    let p3 = points[(segment + 2).min(points.len() - 1)];
    let value = |a: i64, b: i64, c: i64, d: i64| {
        0.5 * (2.0 * b as f64
            + (-a as f64 + c as f64) * u
            + (2 * a - 5 * b + 4 * c - d) as f64 * u * u
            + (-a + 3 * b - 3 * c + d) as f64 * u * u * u)
    };
    round_point(
        value(p0.x_nm, p1.x_nm, p2.x_nm, p3.x_nm),
        value(p0.y_nm, p1.y_nm, p2.y_nm, p3.y_nm),
    )
}
fn ellipse_point(center: Point2, major: Point2, minor: Point2, angle: f64) -> Point2 {
    round_point(
        center.x_nm as f64
            + (major.x_nm - center.x_nm) as f64 * angle.cos()
            + (minor.x_nm - center.x_nm) as f64 * angle.sin(),
        center.y_nm as f64
            + (major.y_nm - center.y_nm) as f64 * angle.cos()
            + (minor.y_nm - center.y_nm) as f64 * angle.sin(),
    )
}
fn ellipse_angle(center: Point2, major: Point2, minor: Point2, point: Point2) -> f64 {
    let ax = (major.x_nm as i128 - center.x_nm as i128) as f64;
    let ay = (major.y_nm as i128 - center.y_nm as i128) as f64;
    let bx = (minor.x_nm as i128 - center.x_nm as i128) as f64;
    let by = (minor.y_nm as i128 - center.y_nm as i128) as f64;
    let px = (point.x_nm as i128 - center.x_nm as i128) as f64;
    let py = (point.y_nm as i128 - center.y_nm as i128) as f64;
    let determinant = ax * by - ay * bx;
    if determinant.abs() < f64::EPSILON {
        0.0
    } else {
        ((ax * py - ay * px) / determinant).atan2((px * by - py * bx) / determinant)
    }
}
fn segment_intersection(
    a0: Point2,
    a1: Point2,
    b0: Point2,
    b1: Point2,
) -> Option<(Point2, f64, f64)> {
    let adx = (a1.x_nm - a0.x_nm) as f64;
    let ady = (a1.y_nm - a0.y_nm) as f64;
    let bdx = (b1.x_nm - b0.x_nm) as f64;
    let bdy = (b1.y_nm - b0.y_nm) as f64;
    let denominator = adx * bdy - ady * bdx;
    if denominator.abs() < 1e-9 {
        return None;
    }
    let ox = (b0.x_nm - a0.x_nm) as f64;
    let oy = (b0.y_nm - a0.y_nm) as f64;
    let ta = (ox * bdy - oy * bdx) / denominator;
    let tb = (ox * ady - oy * adx) / denominator;
    if (0.0..=1.0).contains(&ta) && (0.0..=1.0).contains(&tb) {
        Some((
            round_point(a0.x_nm as f64 + adx * ta, a0.y_nm as f64 + ady * ta),
            ta,
            tb,
        ))
    } else {
        None
    }
}
fn lerp(a: Point2, b: Point2, t: f64) -> Point2 {
    round_point(
        a.x_nm as f64 + (b.x_nm - a.x_nm) as f64 * t,
        a.y_nm as f64 + (b.y_nm - a.y_nm) as f64 * t,
    )
}
fn angle(center: Point2, point: Point2) -> f64 {
    ((point.y_nm - center.y_nm) as f64).atan2((point.x_nm - center.x_nm) as f64)
}
fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x_nm - b.x_nm) as f64).hypot((a.y_nm - b.y_nm) as f64)
}
fn round_point(x: f64, y: f64) -> Point2 {
    Point2::new(x.round() as i64, y.round() as i64)
}
