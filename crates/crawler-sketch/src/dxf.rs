use crate::{Arc, Circle, Geometry, GeometryEntity, GeometryId, Line, Point2, Rectangle, Sketch};
use thiserror::Error;

const NANOMETERS_PER_MILLIMETER: f64 = 1_000_000.0;

#[derive(Debug, Error)]
pub enum DxfError {
    #[error("DXF group code is invalid: {0}")]
    InvalidGroupCode(String),
    #[error("DXF entity {entity} is missing group {group}")]
    MissingGroup { entity: String, group: i32 },
    #[error("DXF value for group {group} is invalid: {value}")]
    InvalidNumber { group: i32, value: String },
    #[error("DXF geometry is invalid: {0}")]
    InvalidGeometry(String),
}

/// Deterministic ASCII DXF used as a human- and tool-inspectable sketch
/// acceptance artifact. Coordinates are emitted in millimetres with six
/// decimal places, preserving the integer-nanometre contract exactly.
pub fn export_dxf(sketch: &Sketch) -> Result<String, DxfError> {
    sketch
        .validate()
        .map_err(|error| DxfError::InvalidGeometry(error.to_string()))?;
    let mut output = String::from(
        "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n",
    );
    for entity in sketch.geometry.values() {
        let layer = if entity.construction {
            "CONSTRUCTION"
        } else {
            "SKETCH"
        };
        match &entity.geometry {
            Geometry::Line(line) => push_line(&mut output, &entity.id.0, layer, line),
            Geometry::Circle(circle) => push_circle(&mut output, &entity.id.0, layer, circle),
            Geometry::Arc(arc) => push_arc(&mut output, &entity.id.0, layer, arc),
            Geometry::Rectangle(rectangle) => {
                let Rectangle { min, max } = rectangle;
                let corners = [
                    *min,
                    Point2::new(max.x_nm, min.y_nm),
                    *max,
                    Point2::new(min.x_nm, max.y_nm),
                ];
                for index in 0..4 {
                    push_line(
                        &mut output,
                        &format!(
                            "{}#{}",
                            entity.id.0,
                            ["bottom", "right", "top", "left"][index]
                        ),
                        layer,
                        &Line {
                            start: corners[index],
                            end: corners[(index + 1) % 4],
                        },
                    );
                }
            }
            Geometry::ControlPointSpline(spline) => {
                push_control_spline(
                    &mut output,
                    &entity.id.0,
                    layer,
                    spline.degree,
                    &spline.control_points,
                    &spline.knots_millionths,
                    None,
                    None,
                );
            }
            Geometry::FitPointSpline(spline) => {
                push_fit_spline(&mut output, &entity.id.0, layer, &spline.fit_points)
            }
            Geometry::Ellipse(ellipse) => push_ellipse(
                &mut output,
                &entity.id.0,
                layer,
                ellipse.center,
                ellipse.major,
                ellipse.minor,
                0.0,
                std::f64::consts::TAU,
                false,
            ),
            Geometry::EllipticalArc(arc) => {
                let start = ellipse_parameter(arc.center, arc.major, arc.minor, arc.start);
                let end = ellipse_parameter(arc.center, arc.major, arc.minor, arc.end);
                push_ellipse(
                    &mut output,
                    &entity.id.0,
                    layer,
                    arc.center,
                    arc.major,
                    arc.minor,
                    start,
                    end,
                    arc.clockwise,
                )
            }
            Geometry::Conic(conic) => push_control_spline(
                &mut output,
                &entity.id.0,
                layer,
                2,
                &[conic.start, conic.control, conic.end],
                &[0, 0, 0, 1_000_000, 1_000_000, 1_000_000],
                Some(&[1_000_000, conic.weight_millionths, 1_000_000]),
                Some("CRAWLER:CONIC"),
            ),
            Geometry::SketchPoint(point) => push_point(&mut output, &entity.id.0, layer, *point),
        }
    }
    output.push_str("0\nENDSEC\n0\nEOF\n");
    Ok(output)
}

fn ellipse_point(center: Point2, major: Point2, minor: Point2, t: f64) -> Point2 {
    let angle = t * std::f64::consts::TAU;
    Point2::new(
        (center.x_nm as f64
            + (major.x_nm - center.x_nm) as f64 * angle.cos()
            + (minor.x_nm - center.x_nm) as f64 * angle.sin())
        .round() as i64,
        (center.y_nm as f64
            + (major.y_nm - center.y_nm) as f64 * angle.cos()
            + (minor.y_nm - center.y_nm) as f64 * angle.sin())
        .round() as i64,
    )
}

fn ellipse_parameter(center: Point2, major: Point2, minor: Point2, point: Point2) -> f64 {
    let ax = (major.x_nm - center.x_nm) as f64;
    let ay = (major.y_nm - center.y_nm) as f64;
    let bx = (minor.x_nm - center.x_nm) as f64;
    let by = (minor.y_nm - center.y_nm) as f64;
    let px = (point.x_nm - center.x_nm) as f64;
    let py = (point.y_nm - center.y_nm) as f64;
    let determinant = ax * by - ay * bx;
    ((ax * py - ay * px) / determinant).atan2((px * by - py * bx) / determinant)
}

/// Import native LINE, CIRCLE, ARC, ELLIPSE, SPLINE, and POINT entities.
/// Unknown entities are ignored so a richer external DXF can still serve as a
/// static comparison workload.
pub fn import_dxf(sketch_id: impl Into<String>, input: &str) -> Result<Sketch, DxfError> {
    let pairs = group_pairs(input)?;
    let mut sketch = Sketch::new(sketch_id);
    let mut in_entities = false;
    let mut current: Option<(String, Vec<(i32, String)>)> = None;
    let mut imported_index = 0_u32;

    let finish = |current: &mut Option<(String, Vec<(i32, String)>)>,
                  sketch: &mut Sketch,
                  imported_index: &mut u32|
     -> Result<(), DxfError> {
        let Some((kind, groups)) = current.take() else {
            return Ok(());
        };
        let geometry = match kind.as_str() {
            "LINE" => Some(Geometry::Line(Line {
                start: Point2::new(nm(&groups, 10, &kind)?, nm(&groups, 20, &kind)?),
                end: Point2::new(nm(&groups, 11, &kind)?, nm(&groups, 21, &kind)?),
            })),
            "CIRCLE" => Some(Geometry::Circle(Circle {
                center: Point2::new(nm(&groups, 10, &kind)?, nm(&groups, 20, &kind)?),
                radius_nm: nm(&groups, 40, &kind)?,
            })),
            "ARC" => {
                let center = Point2::new(nm(&groups, 10, &kind)?, nm(&groups, 20, &kind)?);
                let radius_nm = nm(&groups, 40, &kind)?;
                let dxf_start = radial_point(center, radius_nm, number(&groups, 50, &kind)?);
                let dxf_end = radial_point(center, radius_nm, number(&groups, 51, &kind)?);
                let clockwise = values(&groups, 1000).any(|value| value == "CRAWLER:CLOCKWISE");
                let (start, end) = if clockwise {
                    (dxf_end, dxf_start)
                } else {
                    (dxf_start, dxf_end)
                };
                Some(Geometry::Arc(Arc {
                    center,
                    start,
                    end,
                    clockwise,
                }))
            }
            "ELLIPSE" => {
                let center = Point2::new(nm(&groups, 10, &kind)?, nm(&groups, 20, &kind)?);
                let major = Point2::new(
                    center.x_nm + nm(&groups, 11, &kind)?,
                    center.y_nm + nm(&groups, 21, &kind)?,
                );
                let major_radius =
                    ((major.x_nm - center.x_nm) as f64).hypot((major.y_nm - center.y_nm) as f64);
                let ratio = number(&groups, 40, &kind)?;
                let ux = (major.x_nm - center.x_nm) as f64 / major_radius;
                let uy = (major.y_nm - center.y_nm) as f64 / major_radius;
                let minor = Point2::new(
                    center.x_nm + (-uy * major_radius * ratio).round() as i64,
                    center.y_nm + (ux * major_radius * ratio).round() as i64,
                );
                let start_parameter = optional_number(&groups, 41).unwrap_or(0.0);
                let end_parameter = optional_number(&groups, 42).unwrap_or(std::f64::consts::TAU);
                if (end_parameter - start_parameter).abs() >= std::f64::consts::TAU - 1e-9 {
                    Some(Geometry::Ellipse(crate::Ellipse {
                        center,
                        major,
                        minor,
                    }))
                } else {
                    let start = ellipse_point(
                        center,
                        major,
                        minor,
                        start_parameter / std::f64::consts::TAU,
                    );
                    let end =
                        ellipse_point(center, major, minor, end_parameter / std::f64::consts::TAU);
                    Some(Geometry::EllipticalArc(crate::EllipticalArc {
                        center,
                        major,
                        minor,
                        start,
                        end,
                        clockwise: values(&groups, 1000).any(|value| value == "CRAWLER:CLOCKWISE"),
                    }))
                }
            }
            "SPLINE" => {
                let control_xs = numbers(&groups, 10)?;
                let control_ys = numbers(&groups, 20)?;
                let fit_xs = numbers(&groups, 11)?;
                let fit_ys = numbers(&groups, 21)?;
                if control_xs.len() != control_ys.len() || fit_xs.len() != fit_ys.len() {
                    return Err(DxfError::InvalidGeometry(
                        "SPLINE point count is invalid".into(),
                    ));
                }
                let to_points = |xs: Vec<f64>, ys: Vec<f64>| {
                    xs.into_iter()
                        .zip(ys)
                        .map(|(x, y)| {
                            Point2::new(
                                (x * NANOMETERS_PER_MILLIMETER).round() as i64,
                                (y * NANOMETERS_PER_MILLIMETER).round() as i64,
                            )
                        })
                        .collect::<Vec<_>>()
                };
                let controls = to_points(control_xs, control_ys);
                let fits = to_points(fit_xs, fit_ys);
                let fit_marker =
                    values(&groups, 1000).any(|value| value == "CRAWLER:FIT_POINT_SPLINE");
                let conic_marker = values(&groups, 1000).any(|value| value == "CRAWLER:CONIC");
                let weights = numbers(&groups, 41)?;
                let degree = optional_number(&groups, 71).unwrap_or(3.0).round() as u8;
                if fits.len() >= 2 {
                    Some(Geometry::FitPointSpline(crate::FitPointSpline {
                        fit_points: fits,
                    }))
                } else if fit_marker && controls.len() >= 2 {
                    Some(Geometry::FitPointSpline(crate::FitPointSpline {
                        fit_points: controls,
                    }))
                } else if controls.len() == 3 && degree == 2 && (conic_marker || weights.len() == 3)
                {
                    let weight = optional_number(&groups, 1071)
                        .map(|value| value.round() as i64)
                        .or_else(|| {
                            weights
                                .get(1)
                                .map(|value| (value * 1_000_000.0).round() as i64)
                        })
                        .unwrap_or(1_000_000);
                    Some(Geometry::Conic(crate::Conic {
                        start: controls[0],
                        control: controls[1],
                        end: controls[2],
                        weight_millionths: weight,
                    }))
                } else if controls.len() >= 2 {
                    let knots = numbers(&groups, 40)?
                        .into_iter()
                        .map(|value| (value * 1_000_000.0).round().clamp(0.0, 1_000_000.0) as u32)
                        .collect();
                    Some(Geometry::ControlPointSpline(crate::ControlPointSpline {
                        degree,
                        control_points: controls,
                        knots_millionths: knots,
                    }))
                } else {
                    return Err(DxfError::InvalidGeometry(
                        "SPLINE has neither control nor fit points".into(),
                    ));
                }
            }
            "POINT" => Some(Geometry::SketchPoint(Point2::new(
                nm(&groups, 10, &kind)?,
                nm(&groups, 20, &kind)?,
            ))),
            _ => None,
        };
        if let Some(geometry) = geometry {
            *imported_index += 1;
            let requested = value(&groups, 1000)
                .map(str::to_owned)
                .unwrap_or_else(|| format!("dxf:geometry:{imported_index:04}"));
            let id = unique_id(sketch, requested);
            let construction = value(&groups, 8) == Some("CONSTRUCTION");
            sketch.geometry.insert(
                id.clone(),
                GeometryEntity {
                    id,
                    construction,
                    geometry,
                },
            );
        }
        Ok(())
    };

    let mut iterator = pairs.into_iter().peekable();
    while let Some((code, value)) = iterator.next() {
        if code == 0 && value == "SECTION" {
            in_entities = iterator
                .peek()
                .is_some_and(|(next_code, next_value)| *next_code == 2 && next_value == "ENTITIES");
            continue;
        }
        if code == 0 && value == "ENDSEC" {
            finish(&mut current, &mut sketch, &mut imported_index)?;
            in_entities = false;
            continue;
        }
        if !in_entities || code == 2 && value == "ENTITIES" {
            continue;
        }
        if code == 0 {
            finish(&mut current, &mut sketch, &mut imported_index)?;
            current = Some((value, Vec::new()));
        } else if let Some((_, groups)) = &mut current {
            groups.push((code, value));
        }
    }
    finish(&mut current, &mut sketch, &mut imported_index)?;
    collapse_exported_rectangles(&mut sketch);
    sketch
        .validate()
        .map_err(|error| DxfError::InvalidGeometry(error.to_string()))?;
    Ok(sketch)
}

fn push_header(output: &mut String, kind: &str, id: &str, layer: &str) {
    output.push_str(&format!(
        "0\n{kind}\n8\n{layer}\n1001\nCRAWLER\n1000\n{id}\n"
    ));
}

#[allow(clippy::too_many_arguments)]
fn push_control_spline(
    output: &mut String,
    id: &str,
    layer: &str,
    degree: u8,
    points: &[Point2],
    knots: &[u32],
    weights: Option<&[i64]>,
    marker: Option<&str>,
) {
    push_header(output, "SPLINE", id, layer);
    let canonical_knots = if knots.is_empty() {
        (0..points.len() + degree as usize + 1)
            .map(|index| {
                if index <= degree as usize {
                    0
                } else if index >= points.len() {
                    1_000_000
                } else {
                    ((index - degree as usize) as f64 / (points.len() - degree as usize) as f64
                        * 1_000_000.0)
                        .round() as u32
                }
            })
            .collect::<Vec<_>>()
    } else {
        knots.to_vec()
    };
    output.push_str(&format!(
        "70\n{}\n71\n{degree}\n72\n{}\n73\n{}\n74\n0\n",
        if weights.is_some() { 12 } else { 8 },
        canonical_knots.len(),
        points.len()
    ));
    for knot in canonical_knots {
        output.push_str(&format!("40\n{:.6}\n", knot as f64 / 1_000_000.0));
    }
    if let Some(weights) = weights {
        for weight in weights {
            output.push_str(&format!("41\n{:.12}\n", *weight as f64 / 1_000_000.0));
        }
    }
    for point in points {
        output.push_str(&format!(
            "10\n{}\n20\n{}\n30\n0.000000\n",
            mm(point.x_nm),
            mm(point.y_nm)
        ));
    }
    if let Some(marker) = marker {
        output.push_str(&format!("1000\n{marker}\n"));
    }
    if let Some(weights) = weights
        && let Some(weight) = weights.get(1)
    {
        output.push_str(&format!("1071\n{weight}\n"));
    }
}

fn push_fit_spline(output: &mut String, id: &str, layer: &str, points: &[Point2]) {
    push_header(output, "SPLINE", id, layer);
    output.push_str(&format!(
        "70\n8\n71\n3\n72\n0\n73\n0\n74\n{}\n",
        points.len()
    ));
    for point in points {
        output.push_str(&format!(
            "11\n{}\n21\n{}\n31\n0.000000\n",
            mm(point.x_nm),
            mm(point.y_nm)
        ));
    }
    output.push_str("1000\nCRAWLER:FIT_POINT_SPLINE\n");
}

#[allow(clippy::too_many_arguments)]
fn push_ellipse(
    output: &mut String,
    id: &str,
    layer: &str,
    center: Point2,
    major: Point2,
    minor: Point2,
    start: f64,
    end: f64,
    clockwise: bool,
) {
    push_header(output, "ELLIPSE", id, layer);
    let major_radius = ((major.x_nm - center.x_nm) as f64).hypot((major.y_nm - center.y_nm) as f64);
    let minor_radius = ((minor.x_nm - center.x_nm) as f64).hypot((minor.y_nm - center.y_nm) as f64);
    output.push_str(&format!("10\n{}\n20\n{}\n30\n0.000000\n11\n{}\n21\n{}\n31\n0.000000\n40\n{:.12}\n41\n{:.12}\n42\n{:.12}\n",mm(center.x_nm),mm(center.y_nm),mm(major.x_nm-center.x_nm),mm(major.y_nm-center.y_nm),minor_radius/major_radius,start,end));
    if clockwise {
        output.push_str("1000\nCRAWLER:CLOCKWISE\n");
    }
}

fn push_line(output: &mut String, id: &str, layer: &str, line: &Line) {
    push_header(output, "LINE", id, layer);
    output.push_str(&format!(
        "10\n{}\n20\n{}\n30\n0.000000\n11\n{}\n21\n{}\n31\n0.000000\n",
        mm(line.start.x_nm),
        mm(line.start.y_nm),
        mm(line.end.x_nm),
        mm(line.end.y_nm)
    ));
}

fn push_point(output: &mut String, id: &str, layer: &str, point: Point2) {
    push_header(output, "POINT", id, layer);
    output.push_str(&format!(
        "10\n{}\n20\n{}\n30\n0.000000\n",
        mm(point.x_nm),
        mm(point.y_nm)
    ));
}

fn push_circle(output: &mut String, id: &str, layer: &str, circle: &Circle) {
    push_header(output, "CIRCLE", id, layer);
    output.push_str(&format!(
        "10\n{}\n20\n{}\n30\n0.000000\n40\n{}\n",
        mm(circle.center.x_nm),
        mm(circle.center.y_nm),
        mm(circle.radius_nm)
    ));
}

fn push_arc(output: &mut String, id: &str, layer: &str, arc: &Arc) {
    push_header(output, "ARC", id, layer);
    if arc.clockwise {
        output.push_str("1000\nCRAWLER:CLOCKWISE\n");
    }
    let start = angle(arc.center, arc.start);
    let end = angle(arc.center, arc.end);
    let (start, end) = if arc.clockwise {
        (end, start)
    } else {
        (start, end)
    };
    output.push_str(&format!(
        "10\n{}\n20\n{}\n30\n0.000000\n40\n{}\n50\n{start:.9}\n51\n{end:.9}\n",
        mm(arc.center.x_nm),
        mm(arc.center.y_nm),
        mm(((arc.start.x_nm - arc.center.x_nm) as f64)
            .hypot((arc.start.y_nm - arc.center.y_nm) as f64)
            .round() as i64)
    ));
}

fn mm(value: i64) -> String {
    format!("{:.6}", value as f64 / NANOMETERS_PER_MILLIMETER)
}

fn angle(center: Point2, point: Point2) -> f64 {
    ((point.y_nm - center.y_nm) as f64)
        .atan2((point.x_nm - center.x_nm) as f64)
        .to_degrees()
        .rem_euclid(360.0)
}

fn radial_point(center: Point2, radius_nm: i64, degrees: f64) -> Point2 {
    let radians = degrees.to_radians();
    Point2::new(
        center.x_nm + (radius_nm as f64 * radians.cos()).round() as i64,
        center.y_nm + (radius_nm as f64 * radians.sin()).round() as i64,
    )
}

fn group_pairs(input: &str) -> Result<Vec<(i32, String)>, DxfError> {
    let lines = input.lines().map(str::trim).collect::<Vec<_>>();
    let mut pairs = Vec::new();
    for pair in lines.chunks_exact(2) {
        let code = pair[0]
            .parse::<i32>()
            .map_err(|_| DxfError::InvalidGroupCode(pair[0].to_owned()))?;
        pairs.push((code, pair[1].to_owned()));
    }
    Ok(pairs)
}

fn value(groups: &[(i32, String)], code: i32) -> Option<&str> {
    groups
        .iter()
        .find(|(candidate, _)| *candidate == code)
        .map(|(_, value)| value.as_str())
}

fn values(groups: &[(i32, String)], code: i32) -> impl Iterator<Item = &str> {
    groups
        .iter()
        .filter(move |(candidate, _)| *candidate == code)
        .map(|(_, value)| value.as_str())
}

fn collapse_exported_rectangles(sketch: &mut Sketch) {
    let roles = ["bottom", "right", "top", "left"];
    let bases = sketch
        .geometry
        .keys()
        .filter_map(|id| {
            roles
                .iter()
                .find_map(|role| id.0.strip_suffix(&format!("#{role}")))
        })
        .map(str::to_owned)
        .collect::<std::collections::BTreeSet<_>>();
    for base in bases {
        if sketch.geometry.contains_key(&GeometryId(base.clone())) {
            continue;
        }
        let segments = roles
            .iter()
            .map(|role| sketch.geometry.get(&GeometryId(format!("{base}#{role}"))))
            .collect::<Option<Vec<_>>>();
        let Some(segments) = segments else { continue };
        let construction = segments[0].construction;
        let lines = segments
            .iter()
            .map(|entity| match &entity.geometry {
                Geometry::Line(line) => Some(line.clone()),
                _ => None,
            })
            .collect::<Option<Vec<_>>>();
        let Some(lines) = lines else { continue };
        let min = lines[0].start;
        let max = lines[2].start;
        if lines[0].end != Point2::new(max.x_nm, min.y_nm)
            || lines[1].start != lines[0].end
            || lines[1].end != max
            || lines[2].end != Point2::new(min.x_nm, max.y_nm)
            || lines[3].start != lines[2].end
            || lines[3].end != min
            || segments
                .iter()
                .any(|entity| entity.construction != construction)
        {
            continue;
        }
        for role in roles {
            sketch
                .geometry
                .remove(&GeometryId(format!("{base}#{role}")));
        }
        let id = GeometryId(base);
        sketch.geometry.insert(
            id.clone(),
            GeometryEntity {
                id,
                construction,
                geometry: Geometry::Rectangle(Rectangle { min, max }),
            },
        );
    }
}

fn number(groups: &[(i32, String)], code: i32, entity: &str) -> Result<f64, DxfError> {
    let raw = value(groups, code).ok_or_else(|| DxfError::MissingGroup {
        entity: entity.to_owned(),
        group: code,
    })?;
    raw.parse::<f64>().map_err(|_| DxfError::InvalidNumber {
        group: code,
        value: raw.to_owned(),
    })
}

fn optional_number(groups: &[(i32, String)], code: i32) -> Option<f64> {
    value(groups, code).and_then(|raw| raw.parse().ok())
}

fn numbers(groups: &[(i32, String)], code: i32) -> Result<Vec<f64>, DxfError> {
    values(groups, code)
        .map(|raw| {
            raw.parse::<f64>().map_err(|_| DxfError::InvalidNumber {
                group: code,
                value: raw.to_owned(),
            })
        })
        .collect()
}

fn nm(groups: &[(i32, String)], code: i32, entity: &str) -> Result<i64, DxfError> {
    Ok((number(groups, code, entity)? * NANOMETERS_PER_MILLIMETER).round() as i64)
}

fn unique_id(sketch: &Sketch, requested: String) -> GeometryId {
    let requested = GeometryId(requested);
    if !sketch.geometry.contains_key(&requested) {
        return requested;
    }
    let mut suffix = 2_u32;
    loop {
        let candidate = GeometryId(format!("{}#{suffix}", requested.0));
        if !sketch.geometry.contains_key(&candidate) {
            return candidate;
        }
        suffix += 1;
    }
}
