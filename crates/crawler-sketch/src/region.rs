use crate::{
    Geometry, GeometryId, Point2, ProfileDiagnostic, Sketch, evaluate_curve, intersect_curves,
};
use serde::{Deserialize, Serialize};

/// A stable sketch-region reference. Boundary entity order is canonical and is
/// intentionally separate from the oriented curve order used by a kernel wire.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileRegion {
    pub id: String,
    pub outer: Vec<GeometryId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub holes: Vec<Vec<GeometryId>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RegionDiagnostic {
    Profile {
        diagnostic: ProfileDiagnostic,
    },
    BoundaryIntersection {
        first: Vec<GeometryId>,
        second: Vec<GeometryId>,
        point: Point2,
    },
    UnclassifiableBoundary {
        geometry: Vec<GeometryId>,
    },
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RegionReport {
    pub regions: Vec<ProfileRegion>,
    pub diagnostics: Vec<RegionDiagnostic>,
}

#[derive(Clone)]
struct Boundary {
    geometry: Vec<GeometryId>,
    polygon: Vec<Point2>,
    probe: Point2,
    area_abs: f64,
    depth: usize,
}

impl Sketch {
    /// Classifies closed sketch loops into material regions and holes. Curve
    /// sampling is used only for containment classification; the returned
    /// references always point back to authoritative native sketch entities.
    pub fn region_report(&self) -> RegionReport {
        let profiles = self.profile_report();
        let mut report = RegionReport {
            diagnostics: profiles
                .diagnostics
                .into_iter()
                .map(|diagnostic| RegionDiagnostic::Profile { diagnostic })
                .collect(),
            ..RegionReport::default()
        };
        let mut boundaries = Vec::new();
        for mut geometry in profiles.closed_profiles {
            geometry.sort();
            let Some(polygon) = sampled_boundary(self, &geometry) else {
                report
                    .diagnostics
                    .push(RegionDiagnostic::UnclassifiableBoundary { geometry });
                continue;
            };
            let Some(probe) = interior_probe(&polygon) else {
                report
                    .diagnostics
                    .push(RegionDiagnostic::UnclassifiableBoundary { geometry });
                continue;
            };
            boundaries.push(Boundary {
                area_abs: signed_area(&polygon).abs(),
                geometry,
                polygon,
                probe,
                depth: 0,
            });
        }

        let mut intersecting = vec![false; boundaries.len()];
        for first in 0..boundaries.len() {
            for second in first + 1..boundaries.len() {
                if let Some(point) = boundary_intersection(
                    self,
                    &boundaries[first].geometry,
                    &boundaries[second].geometry,
                ) {
                    intersecting[first] = true;
                    intersecting[second] = true;
                    report
                        .diagnostics
                        .push(RegionDiagnostic::BoundaryIntersection {
                            first: boundaries[first].geometry.clone(),
                            second: boundaries[second].geometry.clone(),
                            point,
                        });
                }
            }
        }

        for index in 0..boundaries.len() {
            if intersecting[index] {
                continue;
            }
            boundaries[index].depth = boundaries
                .iter()
                .enumerate()
                .filter(|(other, boundary)| {
                    *other != index
                        && !intersecting[*other]
                        && boundary.area_abs > boundaries[index].area_abs
                        && point_in_polygon(boundaries[index].probe, &boundary.polygon)
                })
                .count();
        }

        for (index, boundary) in boundaries.iter().enumerate() {
            if intersecting[index] || boundary.depth % 2 == 1 {
                continue;
            }
            let mut holes = boundaries
                .iter()
                .enumerate()
                .filter(|(other, candidate)| {
                    !intersecting[*other]
                        && candidate.depth == boundary.depth + 1
                        && point_in_polygon(candidate.probe, &boundary.polygon)
                })
                .map(|(_, candidate)| candidate.geometry.clone())
                .collect::<Vec<_>>();
            holes.sort();
            report.regions.push(ProfileRegion {
                id: region_id(&boundary.geometry, &holes),
                outer: boundary.geometry.clone(),
                holes,
            });
        }
        report
            .regions
            .sort_by(|first, second| first.id.cmp(&second.id));
        report
    }
}

fn region_id(outer: &[GeometryId], holes: &[Vec<GeometryId>]) -> String {
    let boundary = |ids: &[GeometryId]| {
        ids.iter()
            .map(|id| id.0.as_str())
            .collect::<Vec<_>>()
            .join("+")
    };
    let holes = holes
        .iter()
        .map(|ids| boundary(ids))
        .collect::<Vec<_>>()
        .join(";");
    if holes.is_empty() {
        format!("region:{}", boundary(outer))
    } else {
        format!("region:{}|holes:{holes}", boundary(outer))
    }
}

fn curve_endpoints(geometry: &Geometry) -> Option<(Point2, Point2)> {
    match geometry {
        Geometry::Line(value) => Some((value.start, value.end)),
        Geometry::Arc(value) => Some((value.start, value.end)),
        Geometry::EllipticalArc(value) => Some((value.start, value.end)),
        Geometry::Conic(value) => Some((value.start, value.end)),
        Geometry::ControlPointSpline(value) => Some((
            *value.control_points.first()?,
            *value.control_points.last()?,
        )),
        Geometry::FitPointSpline(value) => {
            Some((*value.fit_points.first()?, *value.fit_points.last()?))
        }
        Geometry::Circle(_)
        | Geometry::Ellipse(_)
        | Geometry::Rectangle(_)
        | Geometry::SketchPoint(_) => None,
    }
}

fn sampled_boundary(sketch: &Sketch, ids: &[GeometryId]) -> Option<Vec<Point2>> {
    if ids.len() == 1 {
        let geometry = &sketch.geometry.get(&ids[0])?.geometry;
        return match geometry {
            Geometry::Rectangle(value) => Some(vec![
                value.min,
                Point2::new(value.max.x_nm, value.min.y_nm),
                value.max,
                Point2::new(value.min.x_nm, value.max.y_nm),
            ]),
            Geometry::Circle(_) | Geometry::Ellipse(_) => Some(
                (0..128)
                    .map(|index| evaluate_curve(geometry, index as f64 / 128.0))
                    .collect(),
            ),
            _ => None,
        };
    }

    let mut remaining = ids.to_vec();
    let first_id = remaining.remove(0);
    let first = &sketch.geometry.get(&first_id)?.geometry;
    let (start, _) = curve_endpoints(first)?;
    let mut ordered = vec![(first_id, false)];
    let mut endpoint = curve_endpoints(first)?.1;
    while !remaining.is_empty() {
        let (position, reversed, next_endpoint) =
            remaining.iter().enumerate().find_map(|(position, id)| {
                let geometry = &sketch.geometry.get(id)?.geometry;
                let (curve_start, curve_end) = curve_endpoints(geometry)?;
                if curve_start == endpoint {
                    Some((position, false, curve_end))
                } else if curve_end == endpoint {
                    Some((position, true, curve_start))
                } else {
                    None
                }
            })?;
        let id = remaining.remove(position);
        ordered.push((id, reversed));
        endpoint = next_endpoint;
    }
    if endpoint != start {
        return None;
    }

    let mut polygon = Vec::new();
    for (index, (id, reversed)) in ordered.into_iter().enumerate() {
        let geometry = &sketch.geometry.get(&id)?.geometry;
        let divisions = match geometry {
            Geometry::Line(_) => 1,
            Geometry::Arc(_) | Geometry::Conic(_) | Geometry::EllipticalArc(_) => 48,
            Geometry::ControlPointSpline(_) | Geometry::FitPointSpline(_) => 64,
            _ => return None,
        };
        let values = (0..=divisions).map(|step| {
            let t = step as f64 / divisions as f64;
            evaluate_curve(geometry, if reversed { 1.0 - t } else { t })
        });
        polygon.extend(values.skip(usize::from(index > 0)));
    }
    if polygon.first() == polygon.last() {
        polygon.pop();
    }
    (polygon.len() >= 3).then_some(polygon)
}

fn boundary_intersection(
    sketch: &Sketch,
    first: &[GeometryId],
    second: &[GeometryId],
) -> Option<Point2> {
    for first_id in first {
        let first_geometry = &sketch.geometry.get(first_id)?.geometry;
        for second_id in second {
            let second_geometry = &sketch.geometry.get(second_id)?.geometry;
            if let (Geometry::Circle(first_circle), Geometry::Circle(second_circle)) =
                (first_geometry, second_geometry)
            {
                if let Some(intersection) =
                    circle_circle_boundary_intersection(first_circle, second_circle)
                {
                    return Some(intersection);
                }
                continue;
            }
            if let Some(intersection) =
                intersect_curves(first_geometry, second_geometry, 128).first()
            {
                return Some(intersection.point);
            }
        }
    }
    None
}

/// Resolve full-circle boundary contact analytically rather than sending the
/// pair through nanometer-accurate adaptive curve sampling. Region
/// classification needs only one deterministic contact point; strictly
/// disjoint and strictly nested circles have no boundary intersection.
fn circle_circle_boundary_intersection(
    first: &crate::Circle,
    second: &crate::Circle,
) -> Option<Point2> {
    let dx = second.center.x_nm as f64 - first.center.x_nm as f64;
    let dy = second.center.y_nm as f64 - first.center.y_nm as f64;
    let distance_squared = dx * dx + dy * dy;
    let first_radius = first.radius_nm.abs() as f64;
    let second_radius = second.radius_nm.abs() as f64;

    if distance_squared == 0.0 {
        return (first_radius == second_radius).then(|| {
            Point2::new(
                first.center.x_nm.saturating_add(first.radius_nm.abs()),
                first.center.y_nm,
            )
        });
    }

    let distance = distance_squared.sqrt();
    if distance > first_radius + second_radius || distance < (first_radius - second_radius).abs() {
        return None;
    }

    // The radical-axis construction yields either crossing point, or the one
    // shared point when the circles are tangent. Choosing the positive
    // perpendicular solution keeps the diagnostic deterministic.
    let along = (first_radius * first_radius - second_radius * second_radius + distance_squared)
        / (2.0 * distance);
    let height = (first_radius * first_radius - along * along)
        .max(0.0)
        .sqrt();
    let unit_x = dx / distance;
    let unit_y = dy / distance;
    Some(Point2::new(
        (first.center.x_nm as f64 + along * unit_x - height * unit_y).round() as i64,
        (first.center.y_nm as f64 + along * unit_y + height * unit_x).round() as i64,
    ))
}

fn signed_area(polygon: &[Point2]) -> f64 {
    polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
        .map(|(first, second)| {
            first.x_nm as f64 * second.y_nm as f64 - second.x_nm as f64 * first.y_nm as f64
        })
        .sum::<f64>()
        / 2.0
}

fn interior_probe(polygon: &[Point2]) -> Option<Point2> {
    let mut y_values = polygon.iter().map(|point| point.y_nm).collect::<Vec<_>>();
    y_values.sort_unstable();
    y_values.dedup();
    for pair in y_values.windows(2) {
        let y = pair[0] as f64 + (pair[1] - pair[0]) as f64 / 2.0;
        let mut crossings = polygon
            .iter()
            .zip(polygon.iter().cycle().skip(1))
            .take(polygon.len())
            .filter_map(|(first, second)| {
                let (first_y, second_y) = (first.y_nm as f64, second.y_nm as f64);
                if (first_y > y) == (second_y > y) {
                    return None;
                }
                let ratio = (y - first_y) / (second_y - first_y);
                Some(first.x_nm as f64 + ratio * (second.x_nm - first.x_nm) as f64)
            })
            .collect::<Vec<_>>();
        crossings.sort_by(f64::total_cmp);
        for inside in crossings.as_chunks::<2>().0 {
            let point = Point2::new(
                ((inside[0] + inside[1]) / 2.0).round() as i64,
                y.round() as i64,
            );
            if point_in_polygon(point, polygon) {
                return Some(point);
            }
        }
    }
    None
}

fn point_in_polygon(point: Point2, polygon: &[Point2]) -> bool {
    let (x, y) = (point.x_nm as f64, point.y_nm as f64);
    let mut inside = false;
    for (first, second) in polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
    {
        let (x1, y1) = (first.x_nm as f64, first.y_nm as f64);
        let (x2, y2) = (second.x_nm as f64, second.y_nm as f64);
        if (y1 > y) != (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1 {
            inside = !inside;
        }
    }
    inside
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Circle, GeometryEntity, Rectangle};
    use std::collections::BTreeMap;

    fn sketch(geometry: impl IntoIterator<Item = GeometryEntity>) -> Sketch {
        let mut sketch = Sketch::new("sketch:regions");
        sketch.geometry = geometry
            .into_iter()
            .map(|entity| (entity.id.clone(), entity))
            .collect::<BTreeMap<_, _>>();
        sketch
    }

    fn circle(id: &str, center: [i64; 2], radius_nm: i64) -> GeometryEntity {
        GeometryEntity::new(
            id,
            Geometry::Circle(Circle {
                center: Point2::new(center[0], center[1]),
                radius_nm,
            }),
        )
    }

    #[test]
    fn classifies_holes_and_islands_independent_of_creation_order() {
        let outer = GeometryEntity::new(
            "rectangle:outer",
            Geometry::Rectangle(Rectangle {
                min: Point2::new(-20_000_000, -20_000_000),
                max: Point2::new(20_000_000, 20_000_000),
            }),
        );
        let hole = GeometryEntity::new(
            "circle:hole",
            Geometry::Circle(Circle {
                center: Point2::new(0, 0),
                radius_nm: 10_000_000,
            }),
        );
        let island = GeometryEntity::new(
            "circle:island",
            Geometry::Circle(Circle {
                center: Point2::new(0, 0),
                radius_nm: 2_000_000,
            }),
        );
        for entities in [
            vec![outer.clone(), hole.clone(), island.clone()],
            vec![island.clone(), outer.clone(), hole.clone()],
        ] {
            let report = sketch(entities).region_report();
            assert!(report.diagnostics.is_empty(), "{report:#?}");
            assert_eq!(report.regions.len(), 2);
            let material = report
                .regions
                .iter()
                .find(|region| region.outer == vec![GeometryId::from("rectangle:outer")])
                .unwrap();
            assert_eq!(material.holes, vec![vec![GeometryId::from("circle:hole")]]);
            assert!(
                report
                    .regions
                    .iter()
                    .any(|region| region.outer == vec![GeometryId::from("circle:island")])
            );
        }
    }

    #[test]
    fn concentric_circle_annulus_is_classified_without_an_intersection() {
        let report = sketch([
            circle("circle:outer", [0, 0], 12_000_000),
            circle("circle:hole", [0, 0], 5_000_000),
        ])
        .region_report();
        assert!(report.diagnostics.is_empty(), "{report:#?}");
        assert_eq!(report.regions.len(), 1);
        assert_eq!(
            report.regions[0].outer,
            vec![GeometryId::from("circle:outer")]
        );
        assert_eq!(
            report.regions[0].holes,
            vec![vec![GeometryId::from("circle:hole")]]
        );
    }

    #[test]
    fn disjoint_circles_remain_independent_regions() {
        let report = sketch([
            circle("circle:left", [-10_000_000, 0], 2_000_000),
            circle("circle:right", [10_000_000, 0], 2_000_000),
        ])
        .region_report();
        assert!(report.diagnostics.is_empty(), "{report:#?}");
        assert_eq!(report.regions.len(), 2);
        assert!(report.regions.iter().all(|region| region.holes.is_empty()));
    }

    #[test]
    fn tangent_circles_are_diagnostic_not_regions() {
        let report = sketch([
            circle("circle:left", [0, 0], 5_000_000),
            circle("circle:right", [10_000_000, 0], 5_000_000),
        ])
        .region_report();
        assert!(report.regions.is_empty());
        assert!(matches!(
            report.diagnostics.as_slice(),
            [RegionDiagnostic::BoundaryIntersection { point, .. }]
                if *point == Point2::new(5_000_000, 0)
        ));
    }

    #[test]
    fn crossing_circles_are_diagnostic_not_regions() {
        let report = sketch([
            circle("circle:left", [-2_000_000, 0], 5_000_000),
            circle("circle:right", [2_000_000, 0], 5_000_000),
        ])
        .region_report();
        assert!(report.regions.is_empty());
        assert!(matches!(
            report.diagnostics.as_slice(),
            [RegionDiagnostic::BoundaryIntersection { .. }]
        ));
    }

    #[test]
    fn coincident_circles_are_diagnostic_not_regions() {
        let report = sketch([
            circle("circle:first", [1_000_000, -2_000_000], 5_000_000),
            circle("circle:second", [1_000_000, -2_000_000], 5_000_000),
        ])
        .region_report();
        assert!(report.regions.is_empty());
        assert!(matches!(
            report.diagnostics.as_slice(),
            [RegionDiagnostic::BoundaryIntersection { point, .. }]
                if *point == Point2::new(6_000_000, -2_000_000)
        ));
    }
}
