//! Compile probe for Monstertruck's browser renderer surface.

#![deny(clippy::all, rust_2018_idioms)]
#![warn(missing_docs, missing_debug_implementations, unsafe_code)]

/// Describes the Monstertruck surface that successfully linked into WASM.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(js_name = compiledRendererSurface))]
pub fn compiled_renderer_surface() -> String {
    format!(
        "Scene={}B; PolygonInstance={}B; webgl-feature=true; canvas-binding=unavailable",
        size_of::<monstertruck_gpu::Scene>(),
        size_of::<monstertruck_render::PolygonInstance>(),
    )
}

/// Size of the linked Monstertruck GPU scene type for the glue-free browser probe.
#[cfg(target_arch = "wasm32")]
#[allow(unsafe_code)]
#[unsafe(export_name = "crawler_probe_scene_size")]
pub extern "C" fn raw_scene_size() -> u32 {
    size_of::<monstertruck_gpu::Scene>() as u32
}

/// Size of the linked Monstertruck render polygon type for the glue-free browser probe.
#[cfg(target_arch = "wasm32")]
#[allow(unsafe_code)]
#[unsafe(export_name = "crawler_probe_polygon_instance_size")]
pub extern "C" fn raw_polygon_instance_size() -> u32 {
    size_of::<monstertruck_render::PolygonInstance>() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_links_renderer_types() {
        let surface = compiled_renderer_surface();
        assert!(surface.contains("Scene="));
        assert!(surface.contains("canvas-binding=unavailable"));
    }
}
