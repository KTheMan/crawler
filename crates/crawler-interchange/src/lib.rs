//! Deterministic, non-mutating exports for the alpha rectangular-prism part.

pub use crawler_feature_kernel::BodySnapshot;
use crawler_feature_kernel::{AxisAlignedBoundsNm, GeometryEvidence};
use crawler_part_engine::{EngineError, PartDimensions, PartEngine};
pub use crawler_render_packet::RenderPacket;
#[cfg(not(target_arch = "wasm32"))]
use crawler_render_packet::packet_from_solid;
#[cfg(target_arch = "wasm32")]
use crawler_render_packet::{
    Bounds3, EdgeRange, FaceRange, PickKind, PickRecord, RENDER_PACKET_VERSION,
};
#[cfg(target_arch = "wasm32")]
use monstertruck_mesh::{PolygonMesh, PolylineCurve};
use monstertruck_meshing::prelude::*;
use monstertruck_modeling::{
    CompressedEdge, CompressedFace, CompressedShell, CompressedSolid, Curve, Point3, Solid,
    Surface, Vector3, builder,
};
use monstertruck_step::save::{CompleteStepDisplay, StepHeaderDescriptor, StepModel};
#[cfg(target_arch = "wasm32")]
use monstertruck_topology::compress::CompressedShell as GenericCompressedShell;
use monstertruck_topology::compress::CompressedSolid as GenericCompressedSolid;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const NANOMETERS_PER_MILLIMETER: f64 = 1_000_000.0;
#[cfg(all(not(target_arch = "wasm32"), test))]
const STEP_TOLERANCE_MILLIMETERS: f64 = 0.001;

/// Supported alpha interchange formats.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExportFormat {
    /// ISO 10303-21 STEP text.
    Step,
    /// Deterministic ASCII STL.
    Stl,
    /// Deterministic Wavefront OBJ.
    Obj,
}

/// In-memory export returned without mutating document or history state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExportArtifact {
    /// Filename extension without a leading dot.
    pub extension: &'static str,
    /// Browser download media type.
    pub media_type: &'static str,
    /// Complete export bytes.
    pub bytes: Vec<u8>,
}

/// Explicit tessellation settings for exporting an authoritative kernel body.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BodyExportSettings {
    /// Maximum tessellation deviation in integer nanometers.
    pub tolerance_nanometers: u64,
}

/// An advanced-body export failure that retains the exact accepted input.
#[derive(Clone, Debug, PartialEq, Error)]
#[error("body export {code}: {message}")]
pub struct BodyExportError {
    /// Stable machine-readable failure category.
    pub code: &'static str,
    /// Actionable diagnostic text.
    pub message: String,
    /// Exact body supplied by the caller, retained for recovery or retry.
    pub preserved_body: Box<BodySnapshot>,
    /// Exact settings supplied by the caller.
    pub settings: BodyExportSettings,
}

/// Export failure with a stable product-facing category.
#[derive(Debug, Error)]
pub enum ExportError {
    /// The authoritative document could not be evaluated.
    #[error("part document is not exportable: {0}")]
    InvalidDocument(#[from] EngineError),
}

/// Exact, persisted STEP import settings.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StepImportSettings {
    /// Tessellation tolerance used for inspection and measurement evidence.
    pub tolerance_nanometers: u64,
}

/// Provenance and inspectable geometry evidence from a STEP source.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StepImportSummary {
    pub source_sha256: String,
    pub source_bytes: usize,
    pub settings: StepImportSettings,
    pub shell_count: usize,
    pub face_count: usize,
    pub triangle_count: usize,
}

/// A save-ready imported kernel body and its authoritative renderer payload.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct StepImportResult {
    /// Deterministic source provenance and inspection evidence.
    pub provenance: StepImportSummary,
    /// Extracted B-rep, ready to persist in a part document.
    pub body: BodySnapshot,
    /// Tessellation and stable topology tokens derived from the same B-rep.
    pub render_packet: RenderPacket,
}

/// STEP failures retain the original bytes and provenance for diagnosis or retry.
#[derive(Clone, Debug, Eq, PartialEq, Error)]
#[error("STEP import {code}: {message}")]
pub struct StepImportError {
    pub code: &'static str,
    pub message: String,
    pub source_sha256: String,
    pub source_bytes: Vec<u8>,
    pub settings: StepImportSettings,
}

/// Parse and inspect every imported shell without changing a part document.
pub fn inspect_step(
    source_bytes: &[u8],
    settings: StepImportSettings,
) -> Result<StepImportSummary, StepImportError> {
    let source_sha256 = format!("{:x}", Sha256::digest(source_bytes));
    let fail = |code, message: String| StepImportError {
        code,
        message,
        source_sha256: source_sha256.clone(),
        source_bytes: source_bytes.to_vec(),
        settings,
    };
    if settings.tolerance_nanometers == 0 {
        return Err(fail(
            "invalid_settings",
            "tessellation tolerance must be positive".into(),
        ));
    }
    let source = std::str::from_utf8(source_bytes)
        .map_err(|error| fail("invalid_encoding", error.to_string()))?;
    let table = monstertruck_step::load::Table::from_step(source)
        .map_err(|error| fail("invalid_step", error.to_string()))?;
    if table.shell.is_empty() {
        return Err(fail(
            "no_supported_geometry",
            "STEP input contains no inspectable shells".into(),
        ));
    }
    let tolerance = settings.tolerance_nanometers as f64 / NANOMETERS_PER_MILLIMETER;
    let mut face_count = 0;
    let mut triangle_count = 0;
    for shell in table.shell.values() {
        let restored = table
            .to_compressed_shell(shell)
            .map_err(|error| fail("invalid_entity", error.to_string()))?;
        face_count += restored.faces.len();
        triangle_count += restored
            .robust_triangulation(tolerance)
            .to_polygon()
            .faces()
            .triangle_iter()
            .count();
    }
    Ok(StepImportSummary {
        source_sha256,
        source_bytes: source_bytes.len(),
        settings,
        shell_count: table.shell.len(),
        face_count,
        triangle_count,
    })
}

/// Imports a supported STEP B-rep into a real kernel body and render packet.
///
/// The caller owns `body_id`. Failures retain the exact source and settings so
/// a document can keep the last acknowledged body while offering retry/export.
pub fn import_step_body(
    source_bytes: &[u8],
    settings: StepImportSettings,
    body_id: impl Into<String>,
) -> Result<StepImportResult, StepImportError> {
    let body_id = body_id.into();
    let source_sha256 = format!("{:x}", Sha256::digest(source_bytes));
    let fail = |code, message: String| StepImportError {
        code,
        message,
        source_sha256: source_sha256.clone(),
        source_bytes: source_bytes.to_vec(),
        settings,
    };
    if body_id.trim().is_empty() {
        return Err(fail(
            "invalid_body_id",
            "imported body identity must be non-empty".into(),
        ));
    }
    if settings.tolerance_nanometers == 0 {
        return Err(fail(
            "invalid_settings",
            "tessellation tolerance must be positive".into(),
        ));
    }
    let source = std::str::from_utf8(source_bytes)
        .map_err(|error| fail("invalid_encoding", error.to_string()))?;
    let table = monstertruck_step::load::Table::from_step(source)
        .map_err(|error| fail("invalid_step", error.to_string()))?;
    if table.shell.is_empty() {
        return Err(fail(
            "no_supported_geometry",
            "STEP input contains no inspectable shells".into(),
        ));
    }

    // Crawler's writer emits MANIFOLD_SOLID_BREP. Prefer those associations so
    // outer and void shells remain grouped; closed bare shells are a supported
    // fallback for otherwise valid B-rep producers.
    let step_boundaries = if table.manifold_solid_brep.is_empty() {
        table
            .shell
            .values()
            .map(|shell| table.to_compressed_shell(shell))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| fail("invalid_entity", error.to_string()))?
    } else {
        let solids = table
            .manifold_solid_brep
            .values()
            .map(|solid| table.to_compressed_solid(solid))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| fail("invalid_entity", error.to_string()))?;
        solids
            .into_iter()
            .flat_map(|solid| solid.boundaries)
            .collect()
    };
    let tolerance = settings.tolerance_nanometers as f64 / NANOMETERS_PER_MILLIMETER;
    let meshed_step = GenericCompressedSolid {
        boundaries: step_boundaries.clone(),
        id_allocator: None,
        attributes: None,
    }
    .robust_triangulation(tolerance);
    let volume = meshed_step.to_polygon().volume().abs();
    if !volume.is_finite() || volume <= f64::EPSILON {
        return Err(fail(
            "empty_body",
            "STEP B-rep has no finite measurable volume".into(),
        ));
    }

    let boundaries: Vec<CompressedShell> = step_boundaries
        .into_iter()
        .map(|shell| {
            let edges = shell
                .edges
                .into_iter()
                .map(|edge| {
                    Curve::try_from(&edge.curve)
                        .map(|curve| CompressedEdge {
                            vertices: edge.vertices,
                            curve,
                        })
                        .map_err(|error| error.to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            let faces = shell
                .faces
                .into_iter()
                .map(|face| {
                    Surface::try_from(&face.surface)
                        .map(|surface| CompressedFace {
                            boundaries: face.boundaries,
                            orientation: face.orientation,
                            surface,
                        })
                        .map_err(|error| error.to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(CompressedShell {
                vertices: shell.vertices,
                edges,
                faces,
                vertex_stable_ids: shell.vertex_stable_ids,
                edge_stable_ids: shell.edge_stable_ids,
                face_stable_ids: shell.face_stable_ids,
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| fail("unsupported_geometry", error))?;
    let mut solid = Solid::extract(CompressedSolid {
        boundaries,
        id_allocator: None,
        attributes: None,
    })
    .map_err(|error| fail("invalid_topology", error.to_string()))?;
    solid.ensure_topology_stable_ids();

    #[cfg(not(target_arch = "wasm32"))]
    let render_packet = packet_from_solid(&mut solid, tolerance)
        .map_err(|error| fail("render_failed", error.to_string()))?;
    #[cfg(target_arch = "wasm32")]
    let render_packet = packet_from_step_mesh(&solid, &meshed_step.boundaries)
        .map_err(|error| fail("render_failed", error))?;
    let bounds_nm = AxisAlignedBoundsNm {
        min: render_packet.bounds.min.map(model_units_to_nanometers),
        max: render_packet.bounds.max.map(model_units_to_nanometers),
    };
    let solid_json = serde_json::to_vec(&solid)
        .map_err(|error| fail("body_encode_failed", error.to_string()))?;
    let evidence_digest = format!("sha256:{:x}", Sha256::digest(&solid_json));
    let body = BodySnapshot {
        body_id,
        solid_json,
        evidence: GeometryEvidence {
            vertex_count: solid.vertex_iter().count(),
            edge_count: solid.edge_iter().count(),
            face_count: solid.face_iter().count(),
            bounds_nm,
            volume_model_units3: volume,
            deterministic_digest: evidence_digest,
        },
    };
    let provenance = StepImportSummary {
        source_sha256,
        source_bytes: source_bytes.len(),
        settings,
        shell_count: solid.boundaries().len(),
        face_count: body.evidence.face_count,
        triangle_count: render_packet.triangle_indices.len() / 3,
    };
    Ok(StepImportResult {
        provenance,
        body,
        render_packet,
    })
}

fn model_units_to_nanometers(value: f64) -> i64 {
    (value * NANOMETERS_PER_MILLIMETER).round() as i64
}

#[cfg(target_arch = "wasm32")]
type StepMeshedShell = GenericCompressedShell<Point3, PolylineCurve<Point3>, Option<PolygonMesh>>;

/// Builds the same selectable packet contract without entering the modeling
/// curve tessellator, whose pinned WASM path still consults `std::time::Instant`.
#[cfg(target_arch = "wasm32")]
fn packet_from_step_mesh(
    solid: &Solid,
    shells: &[StepMeshedShell],
) -> Result<RenderPacket, String> {
    use std::collections::BTreeSet;

    fn as_u32(value: usize, field: &str) -> Result<u32, String> {
        u32::try_from(value).map_err(|_| format!("{field} exceeds the u32 packet limit"))
    }
    fn next_pick(packet: &mut RenderPacket, kind: PickKind, stable_id: u64) -> Result<u32, String> {
        let token = as_u32(packet.pick_table.len() + 1, "pick table")?;
        packet.pick_table.push(PickRecord {
            token,
            kind,
            stable_id,
        });
        Ok(token)
    }
    fn include(bounds: &mut Bounds3, point: Point3) {
        for axis in 0..3 {
            bounds.min[axis] = bounds.min[axis].min(point[axis]);
            bounds.max[axis] = bounds.max[axis].max(point[axis]);
        }
    }

    let source_face_ids = solid
        .face_iter()
        .map(|face| face.stable_id().raw())
        .collect::<Vec<_>>();
    let meshed_faces = shells
        .iter()
        .flat_map(|shell| shell.faces.iter())
        .collect::<Vec<_>>();
    if source_face_ids.len() != meshed_faces.len() {
        return Err(format!(
            "source and tessellated face counts differ: {} != {}",
            source_face_ids.len(),
            meshed_faces.len()
        ));
    }

    let mut packet = RenderPacket {
        version: RENDER_PACKET_VERSION,
        positions: Vec::new(),
        normals: Vec::new(),
        triangle_indices: Vec::new(),
        face_ranges: Vec::new(),
        edge_positions: Vec::new(),
        edge_ranges: Vec::new(),
        vertex_positions: Vec::new(),
        vertex_pick_tokens: Vec::new(),
        pick_table: Vec::new(),
        bounds: Bounds3::default(),
    };

    for (stable_id, face) in source_face_ids.into_iter().zip(meshed_faces) {
        let mut mesh = face
            .surface
            .clone()
            .ok_or_else(|| format!("face with stable id {stable_id} did not tessellate"))?;
        if !face.orientation {
            mesh.invert();
        }
        let expanded = mesh.expands(|attribute| {
            let position = attribute.position;
            let normal = attribute
                .normal
                .unwrap_or_else(|| Vector3::new(0.0, 0.0, 0.0));
            [
                position.x as f32,
                position.y as f32,
                position.z as f32,
                normal.x as f32,
                normal.y as f32,
                normal.z as f32,
            ]
        });
        let vertex_offset = as_u32(packet.positions.len() / 3, "triangle vertices")?;
        for attribute in expanded.attributes() {
            packet.positions.extend_from_slice(&attribute[0..3]);
            packet.normals.extend_from_slice(&attribute[3..6]);
            include(
                &mut packet.bounds,
                Point3::new(
                    attribute[0] as f64,
                    attribute[1] as f64,
                    attribute[2] as f64,
                ),
            );
        }
        let first_index = as_u32(packet.triangle_indices.len(), "triangle indices")?;
        let indices = expanded
            .faces()
            .triangle_iter()
            .flatten()
            .map(|index| {
                u32::try_from(index)
                    .ok()
                    .and_then(|index| index.checked_add(vertex_offset))
                    .ok_or_else(|| "triangle indices exceed the u32 packet limit".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let index_count = as_u32(indices.len(), "face index range")?;
        packet.triangle_indices.extend(indices);
        let pick_token = next_pick(&mut packet, PickKind::Face, stable_id)?;
        packet.face_ranges.push(FaceRange {
            first_index,
            index_count,
            pick_token,
        });
    }

    let mut source_edge_seen = BTreeSet::new();
    let source_edges = solid
        .edge_iter()
        .map(|edge| edge.stable_id().raw())
        .filter(|stable_id| source_edge_seen.insert(*stable_id))
        .collect::<Vec<_>>();
    let meshed_edges = shells
        .iter()
        .flat_map(|shell| shell.edges.iter())
        .collect::<Vec<_>>();
    if source_edges.len() != meshed_edges.len() {
        return Err(format!(
            "source and tessellated edge counts differ: {} != {}",
            source_edges.len(),
            meshed_edges.len()
        ));
    }
    for (stable_id, edge) in source_edges.into_iter().zip(meshed_edges) {
        let first_vertex = as_u32(packet.edge_positions.len() / 3, "edge vertices")?;
        for pair in edge.curve.0.windows(2) {
            for point in pair {
                packet
                    .edge_positions
                    .extend([point.x as f32, point.y as f32, point.z as f32]);
            }
        }
        let vertex_count = as_u32(
            packet.edge_positions.len() / 3 - first_vertex as usize,
            "edge vertex range",
        )?;
        let pick_token = next_pick(&mut packet, PickKind::Edge, stable_id)?;
        packet.edge_ranges.push(EdgeRange {
            first_vertex,
            vertex_count,
            pick_token,
        });
    }

    let mut seen_vertices = BTreeSet::new();
    for vertex in solid.vertex_iter() {
        let stable_id = vertex.stable_id().raw();
        if !seen_vertices.insert(stable_id) {
            continue;
        }
        let point = vertex.point();
        packet
            .vertex_positions
            .extend([point.x as f32, point.y as f32, point.z as f32]);
        let pick_token = next_pick(&mut packet, PickKind::Vertex, stable_id)?;
        packet.vertex_pick_tokens.push(pick_token);
    }
    Ok(packet)
}

/// Export the accepted part result without changing the engine or its history.
pub fn export_part(
    engine: &PartEngine,
    format: ExportFormat,
) -> Result<ExportArtifact, ExportError> {
    let dimensions = engine.dimensions()?;
    Ok(match format {
        ExportFormat::Step => ExportArtifact {
            extension: "step",
            media_type: "model/step",
            bytes: export_step(dimensions),
        },
        ExportFormat::Stl => ExportArtifact {
            extension: "stl",
            media_type: "model/stl",
            bytes: export_stl(dimensions),
        },
        ExportFormat::Obj => ExportArtifact {
            extension: "obj",
            media_type: "model/obj",
            bytes: export_obj(dimensions),
        },
    })
}

/// Export an accepted advanced feature result from its authoritative B-rep.
///
/// STEP is derived directly from the serialized kernel solid. STL and OBJ are
/// derived from one explicit-tolerance tessellation of that same solid. The
/// caller's snapshot is never mutated, and every refusal retains it verbatim.
pub fn export_body(
    body: &BodySnapshot,
    format: ExportFormat,
    settings: BodyExportSettings,
) -> Result<ExportArtifact, BodyExportError> {
    let fail = |code, message: String| BodyExportError {
        code,
        message,
        preserved_body: Box::new(body.clone()),
        settings,
    };
    if settings.tolerance_nanometers == 0 {
        return Err(fail(
            "invalid_settings",
            "tessellation tolerance must be positive".into(),
        ));
    }
    if body.body_id.trim().is_empty() {
        return Err(fail(
            "invalid_body",
            "body identity must be non-empty".into(),
        ));
    }
    let solid: Solid = serde_json::from_slice(&body.solid_json)
        .map_err(|error| fail("invalid_body", error.to_string()))?;
    if solid.boundaries().is_empty() || solid.face_iter().next().is_none() {
        return Err(fail(
            "empty_body",
            "serialized kernel body contains no exportable faces".into(),
        ));
    }

    let tolerance = settings.tolerance_nanometers as f64 / NANOMETERS_PER_MILLIMETER;
    let artifact = match format {
        ExportFormat::Step => ExportArtifact {
            extension: "step",
            media_type: "model/step",
            bytes: export_solid_step(&solid),
        },
        ExportFormat::Stl => {
            let mesh = solid.robust_triangulation(tolerance).to_polygon();
            if mesh.faces().triangle_iter().next().is_none() {
                return Err(fail(
                    "empty_tessellation",
                    "kernel body tessellation contains no triangles".into(),
                ));
            }
            let mut bytes = Vec::new();
            stl::write(&mesh, &mut bytes, stl::StlType::Ascii)
                .map_err(|error| fail("encode_failed", error.to_string()))?;
            ExportArtifact {
                extension: "stl",
                media_type: "model/stl",
                bytes,
            }
        }
        ExportFormat::Obj => {
            let mesh = solid.robust_triangulation(tolerance).to_polygon();
            if mesh.faces().triangle_iter().next().is_none() {
                return Err(fail(
                    "empty_tessellation",
                    "kernel body tessellation contains no triangles".into(),
                ));
            }
            let mut bytes = Vec::new();
            obj::write(&mesh, &mut bytes)
                .map_err(|error| fail("encode_failed", error.to_string()))?;
            ExportArtifact {
                extension: "obj",
                media_type: "model/obj",
                bytes,
            }
        }
    };
    Ok(artifact)
}

fn millimeters(nanometers: i64) -> f64 {
    nanometers as f64 / NANOMETERS_PER_MILLIMETER
}

fn box_solid(dimensions: PartDimensions) -> Solid {
    let vertex = builder::vertex(Point3::new(0.0, 0.0, 0.0));
    let edge = builder::extrude(
        &vertex,
        Vector3::unit_x() * millimeters(dimensions.width_nanometers),
    );
    let face = builder::extrude(
        &edge,
        Vector3::unit_y() * millimeters(dimensions.height_nanometers),
    );
    builder::extrude(
        &face,
        Vector3::unit_z() * millimeters(dimensions.distance_nanometers),
    )
}

#[cfg(not(target_arch = "wasm32"))]
fn export_step(dimensions: PartDimensions) -> Vec<u8> {
    export_solid_step(&box_solid(dimensions))
}

#[cfg(not(target_arch = "wasm32"))]
fn export_solid_step(solid: &Solid) -> Vec<u8> {
    let compressed = solid.compress();
    let mut text = CompleteStepDisplay::new(
        StepModel::from(&compressed),
        StepHeaderDescriptor {
            file_name: "crawler-part.step".to_owned(),
            time_stamp: "1970-01-01 00:00:00".to_owned(),
            authors: vec!["Crawler".to_owned()],
            organization: vec!["Crawler".to_owned()],
            organization_system: "Crawler".to_owned(),
            authorization: String::new(),
        },
    )
    .to_string();
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text.into_bytes()
}

#[cfg(target_arch = "wasm32")]
fn export_step(dimensions: PartDimensions) -> Vec<u8> {
    export_solid_step(&box_solid(dimensions))
}

#[cfg(target_arch = "wasm32")]
fn export_solid_step(solid: &Solid) -> Vec<u8> {
    let compressed = solid.compress();
    let mut text = CompleteStepDisplay::new(
        StepModel::from(&compressed),
        StepHeaderDescriptor {
            file_name: "crawler-part.step".to_owned(),
            time_stamp: "1970-01-01 00:00:00".to_owned(),
            authors: vec!["Crawler".to_owned()],
            organization: vec!["Crawler".to_owned()],
            organization_system: "Crawler".to_owned(),
            authorization: String::new(),
        },
    )
    .to_string();
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text.into_bytes()
}

fn vertices(dimensions: PartDimensions) -> [[f64; 3]; 8] {
    let x = millimeters(dimensions.width_nanometers);
    let y = millimeters(dimensions.height_nanometers);
    let z = millimeters(dimensions.distance_nanometers);
    [
        [0.0, 0.0, 0.0],
        [x, 0.0, 0.0],
        [x, y, 0.0],
        [0.0, y, 0.0],
        [0.0, 0.0, z],
        [x, 0.0, z],
        [x, y, z],
        [0.0, y, z],
    ]
}

// Counter-clockwise triangles as viewed from outside the rectangular prism.
const TRIANGLES: [[usize; 3]; 12] = [
    [0, 2, 1],
    [0, 3, 2], // bottom
    [4, 5, 6],
    [4, 6, 7], // top
    [0, 1, 5],
    [0, 5, 4], // front
    [1, 2, 6],
    [1, 6, 5], // right
    [2, 3, 7],
    [2, 7, 6], // back
    [3, 0, 4],
    [3, 4, 7], // left
];

fn export_obj(dimensions: PartDimensions) -> Vec<u8> {
    let mut output = String::from("# Crawler accepted part result\no CrawlerPart\n");
    for [x, y, z] in vertices(dimensions) {
        output.push_str(&format!("v {x:.9} {y:.9} {z:.9}\n"));
    }
    for triangle in TRIANGLES {
        output.push_str(&format!(
            "f {} {} {}\n",
            triangle[0] + 1,
            triangle[1] + 1,
            triangle[2] + 1
        ));
    }
    output.into_bytes()
}

fn export_stl(dimensions: PartDimensions) -> Vec<u8> {
    let vertices = vertices(dimensions);
    let mut output = String::from("solid CrawlerPart\n");
    for [a, b, c] in TRIANGLES {
        let normal = triangle_normal(vertices[a], vertices[b], vertices[c]);
        output.push_str(&format!(
            "  facet normal {:.9} {:.9} {:.9}\n    outer loop\n",
            normal[0], normal[1], normal[2]
        ));
        for [x, y, z] in [vertices[a], vertices[b], vertices[c]] {
            output.push_str(&format!("      vertex {x:.9} {y:.9} {z:.9}\n"));
        }
        output.push_str("    endloop\n  endfacet\n");
    }
    output.push_str("endsolid CrawlerPart\n");
    output.into_bytes()
}

fn triangle_normal(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> [f64; 3] {
    let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];
    let length = (cross[0].powi(2) + cross[1].powi(2) + cross[2].powi(2)).sqrt();
    [cross[0] / length, cross[1] / length, cross[2] / length]
}

#[cfg(test)]
mod tests {
    use crawler_feature_kernel::{
        FeatureOperation, FeatureRequest, LinearPatternInput, PrincipalAxis, RevolveInput,
        TransformSource, execute,
    };
    use crawler_part_engine::{NewPartCommand, ParameterEdit, WIDTH_PARAMETER_ID};
    use monstertruck_step::load::Table;

    use super::*;

    fn edited_part() -> PartEngine {
        let mut engine = PartEngine::new_part(NewPartCommand::cube(
            "document:export",
            "Export Fixture",
            10_000_000,
        ))
        .expect("fixture must be valid");
        engine
            .commit(vec![ParameterEdit::length(WIDTH_PARAMETER_ID, 20_000_000)])
            .expect("width edit must commit");
        engine
    }

    fn patterned_body() -> BodySnapshot {
        let revolved = execute(&FeatureRequest {
            schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
            document_id: "document:interchange-body".into(),
            feature_id: "feature:revolve".into(),
            output_body_id: "body:revolve".into(),
            operation: FeatureOperation::Revolve(RevolveInput {
                axis_origin_nm: [0, 0, 0],
                axis: PrincipalAxis::Z,
                inner_radius_nm: 0,
                outer_radius_nm: 5_000_000,
                axial_start_nm: 0,
                axial_end_nm: 2_000_000,
                sweep_microdegrees: 360_000_000,
                divisions: 12,
                tolerance_nm: 50_000,
            }),
        })
        .unwrap();
        execute(&FeatureRequest {
            schema_version: crawler_feature_kernel::FEATURE_KERNEL_SCHEMA_VERSION,
            document_id: "document:interchange-body".into(),
            feature_id: "feature:pattern".into(),
            output_body_id: "body:pattern".into(),
            operation: FeatureOperation::LinearPattern(LinearPatternInput {
                source: TransformSource::Body {
                    body: revolved.output,
                },
                instance_body_ids: vec!["body:instance:0".into(), "body:instance:1".into()],
                step_nm: [15_000_000, 0, 0],
                tolerance_nm: 50_000,
            }),
        })
        .unwrap()
        .output
    }

    #[test]
    fn all_exports_leave_document_and_undo_history_unchanged() {
        let engine = edited_part();
        let before_bytes = engine.canonical_document_bytes().unwrap();
        let before_hash = engine.semantic_hash().unwrap();
        let before_history = engine.history_depths();

        for format in [ExportFormat::Step, ExportFormat::Stl, ExportFormat::Obj] {
            let first = export_part(&engine, format).unwrap();
            let second = export_part(&engine, format).unwrap();
            assert!(!first.bytes.is_empty());
            assert_eq!(first, second);
        }

        assert_eq!(engine.canonical_document_bytes().unwrap(), before_bytes);
        assert_eq!(engine.semantic_hash().unwrap(), before_hash);
        assert_eq!(engine.history_depths(), before_history);
    }

    #[test]
    fn step_round_trips_to_a_tessellatable_shell() {
        let artifact = export_part(&edited_part(), ExportFormat::Step).unwrap();
        let table = Table::from_step(std::str::from_utf8(&artifact.bytes).unwrap()).unwrap();
        let shell = table
            .shell
            .values()
            .next()
            .expect("STEP must contain a shell");
        let restored = table.to_compressed_shell(shell).unwrap();
        assert!(
            restored
                .robust_triangulation(STEP_TOLERANCE_MILLIMETERS)
                .to_polygon()
                .faces()
                .triangle_iter()
                .next()
                .is_some()
        );
    }

    #[test]
    fn mesh_exports_contain_the_edited_dimensions_and_twelve_triangles() {
        let obj = String::from_utf8(
            export_part(&edited_part(), ExportFormat::Obj)
                .unwrap()
                .bytes,
        )
        .unwrap();
        let stl = String::from_utf8(
            export_part(&edited_part(), ExportFormat::Stl)
                .unwrap()
                .bytes,
        )
        .unwrap();

        assert!(obj.contains("v 20.000000000 10.000000000 10.000000000"));
        assert_eq!(
            obj.lines().filter(|line| line.starts_with("f ")).count(),
            12
        );
        assert_eq!(stl.matches("facet normal").count(), 12);
        assert!(stl.contains("vertex 20.000000000 10.000000000 10.000000000"));
    }

    #[test]
    fn exported_step_imports_with_provenance_and_inspection_evidence() {
        let artifact = export_part(&edited_part(), ExportFormat::Step).unwrap();
        let settings = StepImportSettings {
            tolerance_nanometers: 10_000,
        };
        let summary = inspect_step(&artifact.bytes, settings).unwrap();

        assert_eq!(
            summary.source_sha256,
            format!("{:x}", Sha256::digest(&artifact.bytes))
        );
        assert_eq!(summary.source_bytes, artifact.bytes.len());
        assert_eq!(summary.settings, settings);
        assert_eq!(summary.shell_count, 1);
        assert_eq!(summary.face_count, 6);
        assert!(summary.triangle_count >= 12);
    }

    #[test]
    fn crawler_brep_import_materializes_exact_body_and_render_topology() {
        let source = include_bytes!(
            "../../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step"
        );
        let settings = StepImportSettings {
            tolerance_nanometers: 10_000,
        };
        let imported = import_step_body(source, settings, "body:import:cube").unwrap();

        assert_eq!(imported.body.body_id, "body:import:cube");
        // The persisted solid retains each face-local STEP edge use. The render
        // packet deduplicates those uses by stable topology identity below.
        assert_eq!(imported.body.evidence.vertex_count, 24);
        assert_eq!(imported.body.evidence.edge_count, 24);
        assert_eq!(imported.body.evidence.face_count, 6);
        assert_eq!(imported.body.evidence.bounds_nm.min, [0, 0, 0]);
        assert_eq!(
            imported.body.evidence.bounds_nm.max,
            [10_000_000, 10_000_000, 10_000_000]
        );
        assert_eq!(imported.render_packet.bounds.min, [0.0, 0.0, 0.0]);
        assert_eq!(imported.render_packet.bounds.max, [10.0, 10.0, 10.0]);
        assert_eq!(imported.render_packet.face_ranges.len(), 6);
        assert_eq!(imported.render_packet.edge_ranges.len(), 12);
        assert_eq!(imported.render_packet.vertex_pick_tokens.len(), 8);
        assert_eq!(imported.render_packet.pick_table.len(), 26);
        assert!(!imported.render_packet.triangle_indices.is_empty());
        assert_eq!(
            imported.provenance.triangle_count,
            imported.render_packet.triangle_indices.len() / 3
        );
        let decoded: Solid = serde_json::from_slice(&imported.body.solid_json).unwrap();
        assert_eq!(decoded.face_iter().count(), 6);

        let repeated = import_step_body(source, settings, "body:import:cube").unwrap();
        assert_eq!(imported, repeated);
    }

    #[test]
    fn body_import_failures_preserve_source_settings_and_identity_validation() {
        let invalid = b"ISO-10303-21;\nDATA;\n#broken\nENDSEC;\nEND-ISO-10303-21;\n";
        let settings = StepImportSettings {
            tolerance_nanometers: 10_000,
        };
        let invalid_step = import_step_body(invalid, settings, "body:import").unwrap_err();
        assert_eq!(invalid_step.code, "invalid_step");
        assert_eq!(invalid_step.source_bytes, invalid);
        assert_eq!(invalid_step.settings, settings);

        let source = include_bytes!(
            "../../../fixtures/reference-models/step-roundtrip-cube/samples/cube-brep.step"
        );
        let invalid_id = import_step_body(source, settings, " ").unwrap_err();
        assert_eq!(invalid_id.code, "invalid_body_id");
        assert_eq!(invalid_id.source_bytes, source);
    }

    #[test]
    fn invalid_step_retains_source_and_settings_for_diagnosis() {
        let source = b"ISO-10303-21;\nDATA;\n#broken\nENDSEC;\nEND-ISO-10303-21;\n";
        let settings = StepImportSettings {
            tolerance_nanometers: 10_000,
        };
        let error = inspect_step(source, settings).unwrap_err();

        assert_eq!(error.code, "invalid_step");
        assert_eq!(error.source_bytes, source);
        assert_eq!(error.settings, settings);
        assert_eq!(error.source_sha256, format!("{:x}", Sha256::digest(source)));
    }

    #[test]
    fn advanced_body_exports_are_deterministic_and_leave_snapshot_unchanged() {
        let body = patterned_body();
        let before = body.clone();
        let settings = BodyExportSettings {
            tolerance_nanometers: 50_000,
        };

        for format in [ExportFormat::Step, ExportFormat::Stl, ExportFormat::Obj] {
            let first = export_body(&body, format, settings).unwrap();
            let second = export_body(&body, format, settings).unwrap();
            assert!(!first.bytes.is_empty());
            assert_eq!(first, second);
        }
        assert_eq!(body, before);
    }

    #[test]
    fn advanced_body_step_round_trips_all_pattern_shells() {
        let body = patterned_body();
        let settings = BodyExportSettings {
            tolerance_nanometers: 50_000,
        };
        let step = export_body(&body, ExportFormat::Step, settings).unwrap();
        let summary = inspect_step(
            &step.bytes,
            StepImportSettings {
                tolerance_nanometers: settings.tolerance_nanometers,
            },
        )
        .unwrap();

        assert_eq!(summary.shell_count, 2);
        assert!(summary.face_count > 0);
        assert!(summary.triangle_count > 0);
    }

    #[test]
    fn invalid_advanced_body_export_retains_exact_input_and_settings() {
        let mut body = patterned_body();
        body.solid_json = b"not a kernel solid".to_vec();
        let settings = BodyExportSettings {
            tolerance_nanometers: 50_000,
        };
        let error = export_body(&body, ExportFormat::Step, settings).unwrap_err();

        assert_eq!(error.code, "invalid_body");
        assert_eq!(*error.preserved_body, body);
        assert_eq!(error.settings, settings);
    }
}
