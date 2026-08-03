//! Provenance-rich render packets for Crawler's renderer-boundary spike.

#![deny(clippy::all, rust_2018_idioms)]
#![warn(missing_docs, missing_debug_implementations, unsafe_code)]

use std::collections::BTreeMap;
#[cfg(not(target_arch = "wasm32"))]
use std::collections::BTreeSet;

use monstertruck_meshing::prelude::*;
use monstertruck_modeling::{Point3, Solid, Vector3, builder};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Current binary render-packet contract version.
pub const RENDER_PACKET_VERSION: u16 = 1;

/// Type of topology addressed by a pick token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum PickKind {
    /// A B-rep face.
    Face = 1,
    /// A B-rep edge.
    Edge = 2,
    /// A B-rep vertex.
    Vertex = 3,
}

/// Mapping from a dense renderer token to persistent kernel topology.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PickRecord {
    /// Dense nonzero token encoded by the renderer.
    pub token: u32,
    /// Topological element kind.
    pub kind: PickKind,
    /// Stable Monstertruck identifier, unique within the owning solid.
    pub stable_id: u64,
}

/// Contiguous triangle-index range produced by one source face.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FaceRange {
    /// First element in [`RenderPacket::triangle_indices`].
    pub first_index: u32,
    /// Number of index elements in the range.
    pub index_count: u32,
    /// Dense pick token for the source face.
    pub pick_token: u32,
}

/// Contiguous line-list vertex range produced by one source edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EdgeRange {
    /// First vertex in [`RenderPacket::edge_positions`].
    pub first_vertex: u32,
    /// Number of line-list vertices in the range.
    pub vertex_count: u32,
    /// Dense pick token for the source edge.
    pub pick_token: u32,
}

/// Axis-aligned packet bounds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bounds3 {
    /// Minimum model-space coordinates.
    pub min: [f64; 3],
    /// Maximum model-space coordinates.
    pub max: [f64; 3],
}

impl Default for Bounds3 {
    fn default() -> Self {
        Self {
            min: [f64::INFINITY; 3],
            max: [f64::NEG_INFINITY; 3],
        }
    }
}

impl Bounds3 {
    fn include(&mut self, point: Point3) {
        (0..3).for_each(|axis| {
            self.min[axis] = self.min[axis].min(point[axis]);
            self.max[axis] = self.max[axis].max(point[axis]);
        });
    }
}

/// Transfer-oriented geometry and topology provenance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderPacket {
    /// Packet schema version.
    pub version: u16,
    /// Packed model-space triangle positions.
    pub positions: Vec<f32>,
    /// Packed model-space triangle normals.
    pub normals: Vec<f32>,
    /// Triangle-list indices.
    pub triangle_indices: Vec<u32>,
    /// Source-face ranges in the triangle index buffer.
    pub face_ranges: Vec<FaceRange>,
    /// Packed line-list positions for source edges.
    pub edge_positions: Vec<f32>,
    /// Source-edge ranges in the line-list buffer.
    pub edge_ranges: Vec<EdgeRange>,
    /// Packed source-vertex positions.
    pub vertex_positions: Vec<f32>,
    /// Pick token parallel to each source vertex.
    pub vertex_pick_tokens: Vec<u32>,
    /// Dense-token lookup table.
    pub pick_table: Vec<PickRecord>,
    /// Geometry bounds.
    pub bounds: Bounds3,
}

impl RenderPacket {
    /// Total bytes in transferable numeric buffers.
    pub fn transferable_bytes(&self) -> usize {
        self.positions.len() * size_of::<f32>()
            + self.normals.len() * size_of::<f32>()
            + self.triangle_indices.len() * size_of::<u32>()
            + self.face_ranges.len() * 3 * size_of::<u32>()
            + self.edge_positions.len() * size_of::<f32>()
            + self.edge_ranges.len() * 3 * size_of::<u32>()
            + self.vertex_positions.len() * size_of::<f32>()
            + self.vertex_pick_tokens.len() * size_of::<u32>()
            + self.pick_table.len() * 4 * size_of::<u32>()
            + 6 * size_of::<f64>()
    }

    /// Returns the provenance record for a dense token.
    pub fn pick_record(&self, token: u32) -> Option<&PickRecord> {
        self.pick_table.iter().find(|record| record.token == token)
    }
}

/// Render-packet construction failure.
#[derive(Debug, Error, PartialEq)]
pub enum RenderPacketError {
    /// Tessellation tolerance must be finite and positive.
    #[error("tessellation tolerance must be finite and positive")]
    InvalidTolerance,
    /// Source and tessellated topology did not preserve iterable correspondence.
    #[error("source and tessellated {kind} counts differ: {source_count} != {tessellated}")]
    TopologyMismatch {
        /// Topology collection that differed.
        kind: &'static str,
        /// Source count.
        source_count: usize,
        /// Tessellated count.
        tessellated: usize,
    },
    /// A source face did not produce a mesh.
    #[error("face with stable id {stable_id} did not tessellate")]
    MissingFaceMesh {
        /// Source face stable identifier.
        stable_id: u64,
    },
    /// A packet collection exceeded the 32-bit GPU addressing contract.
    #[error("{field} exceeds the u32 packet limit")]
    PacketTooLarge {
        /// Collection that exceeded the limit.
        field: &'static str,
    },
}

fn as_u32(value: usize, field: &'static str) -> Result<u32, RenderPacketError> {
    u32::try_from(value).map_err(|_| RenderPacketError::PacketTooLarge { field })
}

fn next_pick(
    pick_table: &mut Vec<PickRecord>,
    kind: PickKind,
    stable_id: u64,
) -> Result<u32, RenderPacketError> {
    let token = as_u32(pick_table.len() + 1, "pick table")?;
    pick_table.push(PickRecord {
        token,
        kind,
        stable_id,
    });
    Ok(token)
}

/// Builds a packet without exposing raw shape handles to JavaScript.
#[cfg(not(target_arch = "wasm32"))]
pub fn packet_from_solid(
    solid: &mut Solid,
    tolerance: f64,
) -> Result<RenderPacket, RenderPacketError> {
    if !tolerance.is_finite() || tolerance <= 0.0 {
        return Err(RenderPacketError::InvalidTolerance);
    }

    solid.ensure_topology_stable_ids();
    let tessellated = solid.triangulation(tolerance);
    let source_faces = solid.face_iter().collect::<Vec<_>>();
    let meshed_faces = tessellated.face_iter().collect::<Vec<_>>();
    if source_faces.len() != meshed_faces.len() {
        return Err(RenderPacketError::TopologyMismatch {
            kind: "face",
            source_count: source_faces.len(),
            tessellated: meshed_faces.len(),
        });
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

    source_faces
        .iter()
        .zip(&meshed_faces)
        .try_for_each(|(source_face, meshed_face)| {
            let stable_id = source_face.stable_id().raw();
            let mut mesh = meshed_face
                .surface()
                .ok_or(RenderPacketError::MissingFaceMesh { stable_id })?;
            if !meshed_face.orientation() {
                mesh.invert();
            }
            let expanded = mesh.expands(|attribute| {
                let position = attribute.position;
                let normal = attribute.normal.unwrap_or_else(Vector3::zero);
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
            expanded.attributes().iter().for_each(|attribute| {
                packet.positions.extend_from_slice(&attribute[0..3]);
                packet.normals.extend_from_slice(&attribute[3..6]);
                packet.bounds.include(Point3::new(
                    attribute[0] as f64,
                    attribute[1] as f64,
                    attribute[2] as f64,
                ));
            });
            let first_index = as_u32(packet.triangle_indices.len(), "triangle indices")?;
            let indices = expanded
                .faces()
                .triangle_iter()
                .flatten()
                .map(|index| {
                    u32::try_from(index)
                        .ok()
                        .and_then(|index| index.checked_add(vertex_offset))
                        .ok_or(RenderPacketError::PacketTooLarge {
                            field: "triangle indices",
                        })
                })
                .collect::<Result<Vec<_>, _>>()?;
            let index_count = as_u32(indices.len(), "face index range")?;
            packet.triangle_indices.extend(indices);
            let pick_token = next_pick(&mut packet.pick_table, PickKind::Face, stable_id)?;
            packet.face_ranges.push(FaceRange {
                first_index,
                index_count,
                pick_token,
            });
            Ok::<(), RenderPacketError>(())
        })?;

    let mut seen_edges = BTreeSet::new();
    source_faces
        .iter()
        .zip(&meshed_faces)
        .try_for_each(|(source_face, meshed_face)| {
            let source_edges = source_face.edge_iter().collect::<Vec<_>>();
            let meshed_edges = meshed_face.edge_iter().collect::<Vec<_>>();
            if source_edges.len() != meshed_edges.len() {
                return Err(RenderPacketError::TopologyMismatch {
                    kind: "face edge-use",
                    source_count: source_edges.len(),
                    tessellated: meshed_edges.len(),
                });
            }
            source_edges
                .iter()
                .zip(&meshed_edges)
                .try_for_each(|(source_edge, meshed_edge)| {
                    let stable_id = source_edge.stable_id().raw();
                    if !seen_edges.insert(stable_id) {
                        return Ok(());
                    }
                    let curve = meshed_edge.oriented_curve();
                    let first_vertex = as_u32(packet.edge_positions.len() / 3, "edge vertices")?;
                    curve.windows(2).for_each(|pair| {
                        pair.iter().for_each(|point| {
                            packet.edge_positions.extend([
                                point.x as f32,
                                point.y as f32,
                                point.z as f32,
                            ]);
                        });
                    });
                    let vertex_count = as_u32(
                        packet.edge_positions.len() / 3 - first_vertex as usize,
                        "edge vertex range",
                    )?;
                    let pick_token = next_pick(&mut packet.pick_table, PickKind::Edge, stable_id)?;
                    packet.edge_ranges.push(EdgeRange {
                        first_vertex,
                        vertex_count,
                        pick_token,
                    });
                    Ok::<(), RenderPacketError>(())
                })
        })?;

    let vertices = solid
        .vertex_iter()
        .fold(BTreeMap::new(), |mut map, vertex| {
            map.entry(vertex.stable_id().raw())
                .or_insert_with(|| vertex.point());
            map
        });
    vertices.into_iter().try_for_each(|(stable_id, point)| {
        packet
            .vertex_positions
            .extend([point.x as f32, point.y as f32, point.z as f32]);
        let pick_token = next_pick(&mut packet.pick_table, PickKind::Vertex, stable_id)?;
        packet.vertex_pick_tokens.push(pick_token);
        Ok::<(), RenderPacketError>(())
    })?;

    Ok(packet)
}

/// Builds the same packet contract on WASM with deterministic fixed sampling.
/// This avoids the pinned modeling crate's unconditional native clock access
/// in its generic curve tessellator.
#[cfg(target_arch = "wasm32")]
pub fn packet_from_solid(
    solid: &mut Solid,
    tolerance: f64,
) -> Result<RenderPacket, RenderPacketError> {
    fixed_sampled_packet_from_solid(solid, tolerance)
}

/// Builds a deterministic packet by sampling each topological edge at a fixed
/// number of parameters and triangulating each sampled face boundary.
///
/// This is Crawler's clock-free WASM evidence path. It is also available on
/// native targets so its geometry and provenance contract can be tested
/// without replacing the robust native tessellator used by [`packet_from_solid`].
pub fn fixed_sampled_packet_from_solid(
    solid: &mut Solid,
    tolerance: f64,
) -> Result<RenderPacket, RenderPacketError> {
    if !tolerance.is_finite() || tolerance <= 0.0 {
        return Err(RenderPacketError::InvalidTolerance);
    }
    solid.ensure_topology_stable_ids();
    crawler_sampled_packet(solid)
}

fn sampled_edge_points(edge: &monstertruck_modeling::Edge) -> Vec<Point3> {
    const DIVISIONS: usize = 12;
    let curve = edge.oriented_curve();
    let (start, end) = curve.range_tuple();
    (0..=DIVISIONS)
        .map(|index| curve.subs(start + (end - start) * index as f64 / DIVISIONS as f64))
        .collect()
}

fn triangle_normal(a: Point3, b: Point3, c: Point3) -> [f32; 3] {
    let ab = b - a;
    let ac = c - a;
    let cross = Vector3::new(
        ab.y * ac.z - ab.z * ac.y,
        ab.z * ac.x - ab.x * ac.z,
        ab.x * ac.y - ab.y * ac.x,
    );
    let length = (cross.x * cross.x + cross.y * cross.y + cross.z * cross.z).sqrt();
    if length <= f64::EPSILON {
        [0.0; 3]
    } else {
        [
            (cross.x / length) as f32,
            (cross.y / length) as f32,
            (cross.z / length) as f32,
        ]
    }
}

fn crawler_sampled_packet(solid: &Solid) -> Result<RenderPacket, RenderPacketError> {
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

    for face in solid.face_iter() {
        let stable_id = face.stable_id().raw();
        let boundary = face
            .boundaries()
            .into_iter()
            .next()
            .ok_or(RenderPacketError::MissingFaceMesh { stable_id })?;
        let mut points = Vec::new();
        for (edge_index, edge) in boundary.iter().enumerate() {
            let samples = sampled_edge_points(edge);
            points.extend(samples.into_iter().skip(usize::from(edge_index > 0)));
        }
        if points.len() > 2 && points.first() == points.last() {
            points.pop();
        }
        if points.len() < 3 {
            return Err(RenderPacketError::MissingFaceMesh { stable_id });
        }
        let scale = 1.0 / points.len() as f64;
        let centroid = Point3::new(
            points.iter().map(|point| point.x).sum::<f64>() * scale,
            points.iter().map(|point| point.y).sum::<f64>() * scale,
            points.iter().map(|point| point.z).sum::<f64>() * scale,
        );
        let first_index = as_u32(packet.triangle_indices.len(), "triangle indices")?;
        for index in 0..points.len() {
            let mut triangle = [centroid, points[index], points[(index + 1) % points.len()]];
            if !face.orientation() {
                triangle.swap(1, 2);
            }
            let normal = triangle_normal(triangle[0], triangle[1], triangle[2]);
            let vertex_offset = as_u32(packet.positions.len() / 3, "triangle vertices")?;
            for point in triangle {
                packet
                    .positions
                    .extend([point.x as f32, point.y as f32, point.z as f32]);
                packet.normals.extend(normal);
                packet.bounds.include(point);
            }
            packet
                .triangle_indices
                .extend([vertex_offset, vertex_offset + 1, vertex_offset + 2]);
        }
        let index_count = as_u32(
            packet.triangle_indices.len() - first_index as usize,
            "face index range",
        )?;
        let pick_token = next_pick(&mut packet.pick_table, PickKind::Face, stable_id)?;
        packet.face_ranges.push(FaceRange {
            first_index,
            index_count,
            pick_token,
        });
    }

    let edges = solid.edge_iter().fold(BTreeMap::new(), |mut map, edge| {
        map.entry(edge.stable_id().raw()).or_insert(edge);
        map
    });
    for (stable_id, edge) in edges {
        let points = sampled_edge_points(&edge);
        let first_vertex = as_u32(packet.edge_positions.len() / 3, "edge vertices")?;
        for pair in points.windows(2) {
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
        let pick_token = next_pick(&mut packet.pick_table, PickKind::Edge, stable_id)?;
        packet.edge_ranges.push(EdgeRange {
            first_vertex,
            vertex_count,
            pick_token,
        });
    }

    let vertices = solid
        .vertex_iter()
        .fold(BTreeMap::new(), |mut map, vertex| {
            map.entry(vertex.stable_id().raw())
                .or_insert_with(|| vertex.point());
            map
        });
    for (stable_id, point) in vertices {
        packet
            .vertex_positions
            .extend([point.x as f32, point.y as f32, point.z as f32]);
        packet.vertex_pick_tokens.push(next_pick(
            &mut packet.pick_table,
            PickKind::Vertex,
            stable_id,
        )?);
    }
    Ok(packet)
}

/// Creates the unit-cube fixture used by both renderer arms.
#[cfg(not(target_arch = "wasm32"))]
pub fn reference_cube_packet(tolerance: f64) -> Result<RenderPacket, RenderPacketError> {
    let vertex = builder::vertex(Point3::origin());
    let edge = builder::extrude(&vertex, Vector3::unit_x());
    let face = builder::extrude(&edge, Vector3::unit_y());
    let mut solid = builder::extrude(&face, Vector3::unit_z());
    packet_from_solid(&mut solid, tolerance)
}

/// Creates the same provenance-rich cube packet on WASM without entering the
/// pinned kernel's generic tessellator, whose remaining `std::time::Instant`
/// call traps at runtime. Topology and stable IDs still come from Monstertruck;
/// only the six qualified planar face triangles are emitted by Crawler.
#[cfg(target_arch = "wasm32")]
pub fn reference_cube_packet(tolerance: f64) -> Result<RenderPacket, RenderPacketError> {
    if !tolerance.is_finite() || tolerance <= 0.0 {
        return Err(RenderPacketError::InvalidTolerance);
    }
    let vertex = builder::vertex(Point3::origin());
    let edge = builder::extrude(&vertex, Vector3::unit_x());
    let face = builder::extrude(&edge, Vector3::unit_y());
    let mut solid = builder::extrude(&face, Vector3::unit_z());
    solid.ensure_topology_stable_ids();
    crawler_cube_packet(&solid)
}

#[cfg(target_arch = "wasm32")]
fn crawler_cube_packet(solid: &Solid) -> Result<RenderPacket, RenderPacketError> {
    let faces = [
        (
            [
                [0.0, 1.0, 0.0],
                [1.0, 1.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 0.0, 0.0],
            ],
            [0.0, 0.0, -1.0],
        ),
        (
            [
                [0.0, 0.0, 1.0],
                [1.0, 0.0, 1.0],
                [1.0, 1.0, 1.0],
                [0.0, 1.0, 1.0],
            ],
            [0.0, 0.0, 1.0],
        ),
        (
            [
                [0.0, 0.0, 0.0],
                [0.0, 0.0, 1.0],
                [0.0, 1.0, 1.0],
                [0.0, 1.0, 0.0],
            ],
            [-1.0, 0.0, 0.0],
        ),
        (
            [
                [1.0, 1.0, 0.0],
                [1.0, 1.0, 1.0],
                [1.0, 0.0, 1.0],
                [1.0, 0.0, 0.0],
            ],
            [1.0, 0.0, 0.0],
        ),
        (
            [
                [1.0, 0.0, 0.0],
                [1.0, 0.0, 1.0],
                [0.0, 0.0, 1.0],
                [0.0, 0.0, 0.0],
            ],
            [0.0, -1.0, 0.0],
        ),
        (
            [
                [0.0, 1.0, 0.0],
                [0.0, 1.0, 1.0],
                [1.0, 1.0, 1.0],
                [1.0, 1.0, 0.0],
            ],
            [0.0, 1.0, 0.0],
        ),
    ];
    let source_faces = solid.face_iter().collect::<Vec<_>>();
    if source_faces.len() != faces.len() {
        return Err(RenderPacketError::TopologyMismatch {
            kind: "face",
            source_count: source_faces.len(),
            tessellated: faces.len(),
        });
    }
    let mut packet = RenderPacket {
        version: RENDER_PACKET_VERSION,
        positions: Vec::with_capacity(72),
        normals: Vec::with_capacity(72),
        triangle_indices: Vec::with_capacity(36),
        face_ranges: Vec::with_capacity(6),
        edge_positions: Vec::with_capacity(72),
        edge_ranges: Vec::with_capacity(12),
        vertex_positions: Vec::with_capacity(24),
        vertex_pick_tokens: Vec::with_capacity(8),
        pick_table: Vec::with_capacity(26),
        bounds: Bounds3::default(),
    };
    for (face_index, (source, (positions, normal))) in
        source_faces.into_iter().zip(faces).enumerate()
    {
        let first_vertex = (packet.positions.len() / 3) as u32;
        for position in positions {
            packet.positions.extend(position.map(|value| value as f32));
            packet.normals.extend(normal.map(|value| value as f32));
            packet
                .bounds
                .include(Point3::new(position[0], position[1], position[2]));
        }
        let first_index = packet.triangle_indices.len() as u32;
        packet.triangle_indices.extend([
            first_vertex,
            first_vertex + 1,
            first_vertex + 2,
            first_vertex,
            first_vertex + 2,
            first_vertex + 3,
        ]);
        let pick_token = next_pick(
            &mut packet.pick_table,
            PickKind::Face,
            source.stable_id().raw(),
        )?;
        packet.face_ranges.push(FaceRange {
            first_index,
            index_count: 6,
            pick_token,
        });
        debug_assert_eq!(face_index + 1, packet.face_ranges.len());
    }
    let edges = solid.edge_iter().fold(BTreeMap::new(), |mut map, edge| {
        map.entry(edge.stable_id().raw())
            .or_insert_with(|| (edge.front().point(), edge.back().point()));
        map
    });
    for (stable_id, (front, back)) in edges {
        let first_vertex = (packet.edge_positions.len() / 3) as u32;
        for point in [front, back] {
            packet
                .edge_positions
                .extend([point.x as f32, point.y as f32, point.z as f32]);
        }
        let pick_token = next_pick(&mut packet.pick_table, PickKind::Edge, stable_id)?;
        packet.edge_ranges.push(EdgeRange {
            first_vertex,
            vertex_count: 2,
            pick_token,
        });
    }
    let vertices = solid
        .vertex_iter()
        .fold(BTreeMap::new(), |mut map, vertex| {
            map.entry(vertex.stable_id().raw())
                .or_insert_with(|| vertex.point());
            map
        });
    for (stable_id, point) in vertices {
        packet
            .vertex_positions
            .extend([point.x as f32, point.y as f32, point.z as f32]);
        packet.vertex_pick_tokens.push(next_pick(
            &mut packet.pick_table,
            PickKind::Vertex,
            stable_id,
        )?);
    }
    Ok(packet)
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    use super::*;

    /// JavaScript-facing ownership wrapper for transferable packet arrays.
    #[derive(Debug)]
    #[wasm_bindgen]
    pub struct WasmRenderPacket(RenderPacket);

    #[wasm_bindgen]
    impl WasmRenderPacket {
        /// Creates the shared reference-cube packet.
        #[wasm_bindgen(js_name = referenceCube)]
        pub fn reference_cube(tolerance: f64) -> Result<WasmRenderPacket, JsValue> {
            reference_cube_packet(tolerance)
                .map(WasmRenderPacket)
                .map_err(|error| JsValue::from_str(&error.to_string()))
        }

        /// Packet schema version.
        #[wasm_bindgen(getter)]
        pub fn version(&self) -> u16 {
            self.0.version
        }
        /// Triangle positions.
        pub fn positions(&self) -> Vec<f32> {
            self.0.positions.clone()
        }
        /// Triangle normals.
        pub fn normals(&self) -> Vec<f32> {
            self.0.normals.clone()
        }
        /// Triangle indices.
        #[wasm_bindgen(js_name = triangleIndices)]
        pub fn triangle_indices(&self) -> Vec<u32> {
            self.0.triangle_indices.clone()
        }
        /// Flattened face ranges as first index, count, and pick token.
        #[wasm_bindgen(js_name = faceRanges)]
        pub fn face_ranges(&self) -> Vec<u32> {
            self.0
                .face_ranges
                .iter()
                .flat_map(|range| [range.first_index, range.index_count, range.pick_token])
                .collect()
        }
        /// Edge line-list positions.
        #[wasm_bindgen(js_name = edgePositions)]
        pub fn edge_positions(&self) -> Vec<f32> {
            self.0.edge_positions.clone()
        }
        /// Flattened edge ranges as first vertex, count, and pick token.
        #[wasm_bindgen(js_name = edgeRanges)]
        pub fn edge_ranges(&self) -> Vec<u32> {
            self.0
                .edge_ranges
                .iter()
                .flat_map(|range| [range.first_vertex, range.vertex_count, range.pick_token])
                .collect()
        }
        /// Source vertex positions.
        #[wasm_bindgen(js_name = vertexPositions)]
        pub fn vertex_positions(&self) -> Vec<f32> {
            self.0.vertex_positions.clone()
        }
        /// Source vertex pick tokens.
        #[wasm_bindgen(js_name = vertexPickTokens)]
        pub fn vertex_pick_tokens(&self) -> Vec<u32> {
            self.0.vertex_pick_tokens.clone()
        }
        /// Flattened token table as token, kind, stable-id low word, and high word.
        #[wasm_bindgen(js_name = pickTable)]
        pub fn pick_table(&self) -> Vec<u32> {
            self.0
                .pick_table
                .iter()
                .flat_map(|record| {
                    [
                        record.token,
                        record.kind as u32,
                        record.stable_id as u32,
                        (record.stable_id >> 32) as u32,
                    ]
                })
                .collect()
        }
        /// Packet bounds as six f64 values.
        pub fn bounds(&self) -> Vec<f64> {
            self.0
                .bounds
                .min
                .into_iter()
                .chain(self.0.bounds.max)
                .collect()
        }
        /// Bytes copied into JavaScript-owned typed arrays before transfer.
        #[wasm_bindgen(js_name = transferableBytes)]
        pub fn transferable_bytes(&self) -> usize {
            self.0.transferable_bytes()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use monstertruck_modeling::{Face, Wire, profile};

    use super::*;

    #[test]
    fn cube_packet_maps_every_topology_kind_to_stable_ids() {
        let packet = reference_cube_packet(0.01).expect("the unit cube must tessellate");
        let records = |kind| {
            packet
                .pick_table
                .iter()
                .filter(|record| record.kind == kind)
                .collect::<Vec<_>>()
        };

        assert_eq!(packet.version, RENDER_PACKET_VERSION);
        assert_eq!(records(PickKind::Face).len(), 6);
        assert_eq!(records(PickKind::Edge).len(), 12);
        assert_eq!(records(PickKind::Vertex).len(), 8);
        assert!(packet.pick_table.iter().all(|record| record.stable_id != 0));
        assert_eq!(
            packet
                .pick_table
                .iter()
                .map(|record| record.token)
                .collect::<BTreeSet<_>>()
                .len(),
            packet.pick_table.len()
        );
    }

    #[test]
    fn packet_ranges_are_complete_and_address_valid_buffers() {
        let packet = reference_cube_packet(0.01).expect("the unit cube must tessellate");
        let face_index_count = packet
            .face_ranges
            .iter()
            .map(|range| range.index_count as usize)
            .sum::<usize>();
        let edge_vertex_count = packet
            .edge_ranges
            .iter()
            .map(|range| range.vertex_count as usize)
            .sum::<usize>();

        assert_eq!(face_index_count, packet.triangle_indices.len());
        assert_eq!(edge_vertex_count * 3, packet.edge_positions.len());
        assert_eq!(packet.vertex_positions.len(), 8 * 3);
        assert_eq!(packet.vertex_pick_tokens.len(), 8);
        assert!(
            packet
                .triangle_indices
                .iter()
                .all(|index| (*index as usize) < packet.positions.len() / 3)
        );
        packet.face_ranges.iter().for_each(|range| {
            assert_eq!(
                packet
                    .pick_record(range.pick_token)
                    .map(|record| record.kind),
                Some(PickKind::Face)
            );
        });
        packet.edge_ranges.iter().for_each(|range| {
            assert_eq!(
                packet
                    .pick_record(range.pick_token)
                    .map(|record| record.kind),
                Some(PickKind::Edge)
            );
        });
    }

    #[test]
    fn retessellation_preserves_pick_provenance() {
        let vertex = builder::vertex(Point3::origin());
        let edge = builder::extrude(&vertex, Vector3::unit_x());
        let face = builder::extrude(&edge, Vector3::unit_y());
        let mut solid = builder::extrude(&face, Vector3::unit_z());
        let coarse = packet_from_solid(&mut solid, 0.1).expect("coarse tessellation must succeed");
        let fine = packet_from_solid(&mut solid, 0.001).expect("fine tessellation must succeed");
        let provenance = |packet: &RenderPacket| {
            packet
                .pick_table
                .iter()
                .map(|record| (record.kind, record.stable_id))
                .collect::<BTreeSet<_>>()
        };

        assert_eq!(provenance(&coarse), provenance(&fine));
    }

    #[test]
    fn invalid_tolerance_fails_before_kernel_work() {
        assert_eq!(
            reference_cube_packet(0.0),
            Err(RenderPacketError::InvalidTolerance)
        );
        assert_eq!(
            reference_cube_packet(f64::NAN),
            Err(RenderPacketError::InvalidTolerance)
        );
    }

    #[test]
    fn fixed_sampler_is_deterministic_and_preserves_cube_provenance() {
        let vertex = builder::vertex(Point3::origin());
        let edge = builder::extrude(&vertex, Vector3::unit_x());
        let face = builder::extrude(&edge, Vector3::unit_y());
        let mut solid = builder::extrude(&face, Vector3::unit_z());

        let first = fixed_sampled_packet_from_solid(&mut solid, 0.01).unwrap();
        let second = fixed_sampled_packet_from_solid(&mut solid, 0.01).unwrap();

        assert_eq!(first, second);
        assert_eq!(first.bounds.min, [0.0, 0.0, 0.0]);
        assert_eq!(first.bounds.max, [1.0, 1.0, 1.0]);
        assert_eq!(first.face_ranges.len(), 6);
        assert_eq!(first.edge_ranges.len(), 12);
        assert_eq!(first.vertex_pick_tokens.len(), 8);
        assert!(first.pick_table.iter().all(|record| record.stable_id != 0));
        assert!(first.positions.iter().all(|value| value.is_finite()));
        assert!(first.normals.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn fixed_sampler_handles_curved_revolve_without_native_tessellation() {
        let points = [
            Point3::new(1.0, 0.0, 0.0),
            Point3::new(2.0, 0.0, 0.0),
            Point3::new(2.0, 0.0, 1.0),
            Point3::new(1.0, 0.0, 1.0),
        ];
        let vertices = points.map(builder::vertex);
        let wire: Wire = vec![
            builder::line(&vertices[0], &vertices[1]),
            builder::line(&vertices[1], &vertices[2]),
            builder::line(&vertices[2], &vertices[3]),
            builder::line(&vertices[3], &vertices[0]),
        ]
        .into();
        let face: Face = profile::attach_plane_normalized(vec![wire]).unwrap();
        let mut solid = builder::revolve(
            &face,
            Point3::origin(),
            Vector3::unit_z(),
            builder::SweepAngle::Closed,
            16,
        );

        let packet = fixed_sampled_packet_from_solid(&mut solid, 0.01).unwrap();
        let source_edge_ids = solid
            .edge_iter()
            .map(|edge| edge.stable_id().raw())
            .collect::<BTreeSet<_>>();
        let source_vertex_ids = solid
            .vertex_iter()
            .map(|vertex| vertex.stable_id().raw())
            .collect::<BTreeSet<_>>();

        assert!(!packet.triangle_indices.is_empty());
        assert_eq!(packet.face_ranges.len(), solid.face_iter().count());
        assert_eq!(packet.edge_ranges.len(), source_edge_ids.len());
        assert_eq!(packet.vertex_pick_tokens.len(), source_vertex_ids.len());
        assert!(packet.positions.iter().all(|value| value.is_finite()));
        assert!(packet.normals.iter().all(|value| value.is_finite()));
        assert!(packet.bounds.min[0] <= -1.99);
        assert!(packet.bounds.max[0] >= 1.99);
        assert!(packet.bounds.min[1] <= -1.99);
        assert!(packet.bounds.max[1] >= 1.99);
        assert_eq!(packet.bounds.min[2], 0.0);
        assert_eq!(packet.bounds.max[2], 1.0);
    }
}
