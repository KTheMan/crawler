use monstertruck_modeling::{Curve, Point3, Surface, Vector3, Wire, builder, profile};
use monstertruck_wasm::{IntoWasm, Solid};

/// Render buffers for a Monstertruck reference cube.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CubeMesh {
    pub(crate) vertices: Vec<f32>,
    pub(crate) indices: Vec<u32>,
}

/// Builds a closed planar profile and extrudes it with Monstertruck.
pub(crate) fn reference_cube(edge: f64) -> Result<Solid, String> {
    reference_prism(edge, edge, edge)
}

/// Builds a closed rectangular profile and extrudes it with Monstertruck.
pub(crate) fn reference_prism(width: f64, height: f64, distance: f64) -> Result<Solid, String> {
    let vertices = [
        builder::vertex(Point3::new(0.0, 0.0, 0.0)),
        builder::vertex(Point3::new(width, 0.0, 0.0)),
        builder::vertex(Point3::new(width, height, 0.0)),
        builder::vertex(Point3::new(0.0, height, 0.0)),
    ];
    let wire: Wire = vec![
        builder::line(&vertices[0], &vertices[1]),
        builder::line(&vertices[1], &vertices[2]),
        builder::line(&vertices[2], &vertices[3]),
        builder::line(&vertices[3], &vertices[0]),
    ]
    .into();
    profile::solid_from_planar_profile::<Curve, Surface>(
        vec![wire],
        Vector3::new(0.0, 0.0, distance),
    )
    .map(IntoWasm::into_wasm)
    .map_err(|error| error.to_string())
}

/// Tessellates a Monstertruck reference cube into render buffers.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn tessellate_reference_cube(edge: f64, tolerance: f64) -> Result<CubeMesh, String> {
    tessellate_rectangular_prism(edge, edge, edge, tolerance)
}

/// Tessellates a Monstertruck rectangular prism into qualified render buffers.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn tessellate_rectangular_prism(
    width: f64,
    height: f64,
    distance: f64,
    tolerance: f64,
) -> Result<CubeMesh, String> {
    let buffer = reference_prism(width, height, distance)?
        .to_polygon(tolerance)
        .to_buffer();
    Ok(CubeMesh {
        vertices: buffer.vertex_buffer(),
        indices: buffer.index_buffer(),
    })
}

/// Monstertruck's Phase-5 modeling stack constructs the solid on WASM, but its
/// current generic tessellator still calls `std::time::Instant::now()` and traps
/// at runtime. Keep construction kernel-owned and bridge only the qualified cube
/// tessellation in Crawler until the upstream runtime gate is promoted.
#[cfg(target_arch = "wasm32")]
pub(crate) fn tessellate_reference_cube(edge: f64, _tolerance: f64) -> Result<CubeMesh, String> {
    let _kernel_solid = reference_cube(edge)?;
    Ok(crawler_prism_render_buffer(edge, edge, edge))
}

/// The pinned Monstertruck runtime constructs the exact B-rep in WASM. Until
/// its generic tessellator is promoted for wasm32, Crawler owns this qualified
/// triangle adapter and keeps its layout identical to native PolygonBuffer.
#[cfg(target_arch = "wasm32")]
pub(crate) fn tessellate_rectangular_prism(
    width: f64,
    height: f64,
    distance: f64,
    _tolerance: f64,
) -> Result<CubeMesh, String> {
    let _kernel_solid = reference_prism(width, height, distance)?;
    Ok(crawler_prism_render_buffer(width, height, distance))
}

#[cfg(target_arch = "wasm32")]
fn crawler_prism_render_buffer(width: f64, height: f64, distance: f64) -> CubeMesh {
    let w = width as f32;
    let h = height as f32;
    let d = distance as f32;
    let faces = [
        (
            [[0.0, h, 0.0], [w, h, 0.0], [w, 0.0, 0.0], [0.0, 0.0, 0.0]],
            [0.0, 0.0, -1.0],
        ),
        (
            [[0.0, 0.0, d], [w, 0.0, d], [w, h, d], [0.0, h, d]],
            [0.0, 0.0, 1.0],
        ),
        (
            [[0.0, 0.0, 0.0], [0.0, 0.0, d], [0.0, h, d], [0.0, h, 0.0]],
            [-1.0, 0.0, 0.0],
        ),
        (
            [[w, h, 0.0], [w, h, d], [w, 0.0, d], [w, 0.0, 0.0]],
            [1.0, 0.0, 0.0],
        ),
        (
            [[w, 0.0, 0.0], [w, 0.0, d], [0.0, 0.0, d], [0.0, 0.0, 0.0]],
            [0.0, -1.0, 0.0],
        ),
        (
            [[0.0, h, 0.0], [0.0, h, d], [w, h, d], [w, h, 0.0]],
            [0.0, 1.0, 0.0],
        ),
    ];
    let uvs = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
    let mut vertices = Vec::with_capacity(24 * 8);
    let mut indices = Vec::with_capacity(36);
    for (face_index, (positions, normal)) in faces.into_iter().enumerate() {
        let base = (face_index * 4) as u32;
        for (position, uv) in positions.into_iter().zip(uvs) {
            vertices.extend_from_slice(&[
                position[0],
                position[1],
                position[2],
                uv[0],
                uv[1],
                normal[0],
                normal[1],
                normal[2],
            ]);
        }
        indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    CubeMesh { vertices, indices }
}
