use std::collections::BTreeSet;

use monstertruck_meshing::prelude::*;
use monstertruck_modeling::errors::Error as ModelingError;
use monstertruck_modeling::{
    Curve, Matrix4, Point3, Solid, Surface, ToCompressedTrimmedParameterCurves, Vector3, builder,
    profile,
};
use monstertruck_solid::ShapeOpsError;
use monstertruck_step::load::Table;
use monstertruck_step::save::{CompleteStepDisplay, StepHeaderDescriptor, StepModel};
use monstertruck_topology::StableId;
use monstertruck_wasm::builder as wasm_builder;

const BOOLEAN_TOLERANCE: f64 = 0.05;
const MESH_TOLERANCE: f64 = 0.01;

fn rectangle_wire(width: f64, depth: f64) -> monstertruck_modeling::Wire {
    let vertices = [
        builder::vertex(Point3::new(0.0, 0.0, 0.0)),
        builder::vertex(Point3::new(width, 0.0, 0.0)),
        builder::vertex(Point3::new(width, depth, 0.0)),
        builder::vertex(Point3::new(0.0, depth, 0.0)),
    ];
    vec![
        builder::line(&vertices[0], &vertices[1]),
        builder::line(&vertices[1], &vertices[2]),
        builder::line(&vertices[2], &vertices[3]),
        builder::line(&vertices[3], &vertices[0]),
    ]
    .into()
}

fn profile_box(width: f64, depth: f64, height: f64) -> Solid {
    profile::solid_from_planar_profile(
        vec![rectangle_wire(width, depth)],
        Vector3::new(0.0, 0.0, height),
    )
    .expect("a closed planar rectangle must extrude into a solid")
}

fn swept_box(origin: Point3, size: f64) -> Solid {
    let vertex = builder::vertex(origin);
    let edge = builder::extrude(&vertex, Vector3::unit_x() * size);
    let face = builder::extrude(&edge, Vector3::unit_y() * size);
    builder::extrude(&face, Vector3::unit_z() * size)
}

fn topology_ids(solid: &Solid) -> (BTreeSet<StableId>, BTreeSet<StableId>, BTreeSet<StableId>) {
    (
        solid
            .vertex_iter()
            .map(|vertex| vertex.stable_id())
            .collect(),
        solid.edge_iter().map(|edge| edge.stable_id()).collect(),
        solid.face_iter().map(|face| face.stable_id()).collect(),
    )
}

#[test]
fn planar_profile_extrudes_to_the_expected_closed_box() {
    let solid = profile_box(2.0, 3.0, 4.0);

    assert!(solid.is_geometric_consistent());
    assert_eq!(solid.boundaries().len(), 1);
    assert_eq!(solid.face_iter().count(), 6);
}

#[test]
fn tessellation_produces_renderable_wasm_buffers() {
    let vertex = wasm_builder::vertex(0.0, 0.0, 0.0).upcast();
    let edge = wasm_builder::extrude(&vertex, &[1.0, 0.0, 0.0]);
    let face = wasm_builder::extrude(&edge, &[0.0, 1.0, 0.0]);
    let solid = wasm_builder::extrude(&face, &[0.0, 0.0, 1.0])
        .into_solid()
        .expect("three orthogonal sweeps must produce a solid");
    let buffer = solid.to_polygon(MESH_TOLERANCE).to_buffer();

    assert!(buffer.vertex_buffer_size() > 0);
    assert!(buffer.index_buffer_size() > 0);
    assert_eq!(buffer.vertex_buffer().len() % 8, 0);
    assert_eq!(buffer.index_buffer().len() % 3, 0);
}

#[test]
fn overlapping_box_booleans_have_expected_volume() {
    let first = swept_box(Point3::origin(), 1.0);
    let second = swept_box(Point3::new(0.5, 0.5, 0.5), 1.0);
    let union = monstertruck_solid::or(&first, &second, BOOLEAN_TOLERANCE)
        .expect("overlapping boxes must support union");
    let intersection = monstertruck_solid::and(&first, &second, BOOLEAN_TOLERANCE)
        .expect("overlapping boxes must support intersection");
    let difference = monstertruck_solid::difference(&first, &second, BOOLEAN_TOLERANCE)
        .expect("overlapping boxes must support difference");

    let volume = |solid: &Solid| solid.triangulation(MESH_TOLERANCE).to_polygon().volume();
    assert!((volume(&union) - 1.875).abs() < 1.0e-3);
    assert!((volume(&intersection) - 0.125).abs() < 1.0e-3);
    assert!((volume(&difference) - 0.875).abs() < 1.0e-3);
}

#[test]
fn stable_topology_ids_survive_json_persistence() {
    let mut solid = profile_box(2.0, 3.0, 4.0);
    solid.ensure_topology_stable_ids();
    let expected = topology_ids(&solid);

    assert!(expected.0.iter().all(|id| id.is_assigned()));
    assert!(expected.1.iter().all(|id| id.is_assigned()));
    assert!(expected.2.iter().all(|id| id.is_assigned()));
    assert_eq!(expected.0.len(), 8);
    assert_eq!(expected.1.len(), 12);
    assert_eq!(expected.2.len(), 6);

    let serialized = serde_json::to_vec(&solid).expect("the solid must serialize");
    let restored: Solid = serde_json::from_slice(&serialized).expect("the solid must deserialize");

    assert_eq!(topology_ids(&restored), expected);
}

#[test]
fn step_export_reimports_as_a_tessellatable_shell() {
    let solid = profile_box(2.0, 3.0, 4.0);
    let compressed = solid.compress_with_parameter_curves(MESH_TOLERANCE);
    let step = CompleteStepDisplay::new(
        StepModel::from(&compressed),
        StepHeaderDescriptor {
            organization_system: "Crawler kernel contract".to_owned(),
            ..Default::default()
        },
    )
    .to_string();

    let table = Table::from_step(&step).expect("exported STEP must parse");
    let step_shell = table
        .shell
        .values()
        .next()
        .expect("exported STEP must contain a shell");
    let restored = table
        .to_compressed_shell(step_shell)
        .expect("the imported shell must convert to kernel geometry");
    let mesh = restored.robust_triangulation(MESH_TOLERANCE).to_polygon();

    assert!(mesh.faces().triangle_iter().next().is_some());
}

#[test]
fn native_failures_preserve_typed_error_categories() {
    let vertices = [
        builder::vertex(Point3::new(0.0, 0.0, 0.0)),
        builder::vertex(Point3::new(1.0, 0.0, 0.0)),
        builder::vertex(Point3::new(1.0, 1.0, 0.0)),
    ];
    let open_wire = vec![
        builder::line(&vertices[0], &vertices[1]),
        builder::line(&vertices[1], &vertices[2]),
    ]
    .into();
    let profile_result =
        profile::solid_from_planar_profile::<Curve, Surface>(vec![open_wire], Vector3::unit_z());
    let box_solid = swept_box(Point3::origin(), 1.0);
    let boolean_result =
        monstertruck_solid::clip_half_space_z(&box_solid, Matrix4::from_scale(1.0), true, 0.0);

    assert!(matches!(profile_result, Err(ModelingError::OpenWire)));
    assert!(matches!(
        boolean_result,
        Err(ShapeOpsError::InvalidTolerance)
    ));
}
