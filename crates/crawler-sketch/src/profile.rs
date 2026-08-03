use crate::model::{Geometry, GeometryId, Point2, Sketch};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProfileDiagnostic {
    OpenEndpoint {
        point: Point2,
        geometry: Vec<GeometryId>,
    },
    BranchPoint {
        point: Point2,
        geometry: Vec<GeometryId>,
    },
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileReport {
    pub closed_profiles: Vec<Vec<GeometryId>>,
    pub diagnostics: Vec<ProfileDiagnostic>,
}

impl Sketch {
    /// Diagnoses exact endpoint connectivity. Construction geometry is excluded
    /// because it cannot bound a material profile.
    pub fn profile_report(&self) -> ProfileReport {
        let mut report = ProfileReport::default();
        let mut endpoints: BTreeMap<Point2, Vec<GeometryId>> = BTreeMap::new();
        let mut edge_ids = BTreeSet::new();

        for (id, entity) in &self.geometry {
            if entity.construction {
                continue;
            }
            match &entity.geometry {
                Geometry::Circle(_) | Geometry::Rectangle(_) => {
                    report.closed_profiles.push(vec![id.clone()]);
                }
                Geometry::Line(line) => {
                    endpoints.entry(line.start).or_default().push(id.clone());
                    endpoints.entry(line.end).or_default().push(id.clone());
                    edge_ids.insert(id.clone());
                }
                Geometry::Arc(arc) => {
                    endpoints.entry(arc.start).or_default().push(id.clone());
                    endpoints.entry(arc.end).or_default().push(id.clone());
                    edge_ids.insert(id.clone());
                }
            }
        }

        for geometry in endpoints.values_mut() {
            geometry.sort();
        }
        for (point, geometry) in &endpoints {
            match geometry.len() {
                1 => report.diagnostics.push(ProfileDiagnostic::OpenEndpoint {
                    point: *point,
                    geometry: geometry.clone(),
                }),
                2 => {}
                _ => report.diagnostics.push(ProfileDiagnostic::BranchPoint {
                    point: *point,
                    geometry: geometry.clone(),
                }),
            }
        }

        let mut adjacency: BTreeMap<GeometryId, BTreeSet<GeometryId>> = BTreeMap::new();
        for geometry in endpoints.values() {
            for first in geometry {
                for second in geometry {
                    if first != second {
                        adjacency
                            .entry(first.clone())
                            .or_default()
                            .insert(second.clone());
                    }
                }
            }
        }
        let mut unseen = edge_ids;
        while let Some(start) = unseen.iter().next().cloned() {
            let mut component = Vec::new();
            let mut queue = VecDeque::from([start]);
            while let Some(id) = queue.pop_front() {
                if !unseen.remove(&id) {
                    continue;
                }
                component.push(id.clone());
                if let Some(neighbors) = adjacency.get(&id) {
                    queue.extend(neighbors.iter().cloned());
                }
            }
            component.sort();
            let component_set: BTreeSet<_> = component.iter().cloned().collect();
            let closed = endpoints.values().all(|ids| {
                let degree = ids.iter().filter(|id| component_set.contains(*id)).count();
                degree == 0 || degree == 2
            });
            if closed {
                report.closed_profiles.push(component);
            }
        }
        report.closed_profiles.sort();
        report
    }
}
