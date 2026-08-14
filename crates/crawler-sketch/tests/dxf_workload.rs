use crawler_sketch::{
    Arc, Conic, ControlPointSpline, Ellipse, EllipticalArc, FitPointSpline, Geometry,
    GeometryEntity, GeometryId, Point2, Rectangle, Sketch, export_dxf, import_dxf,
};

const INPUT: &str = include_str!("fixtures/all-geometry.input.dxf");
const EXPECTED: &str = include_str!("fixtures/all-geometry.expected.dxf");

#[test]
fn static_dxf_workload_normalizes_to_the_golden_output_and_round_trips() {
    let imported = import_dxf("sketch:dxf-workload", INPUT).unwrap();
    assert_eq!(imported.geometry.len(), 3);
    assert!(imported.geometry[&GeometryId::from("line:datum")].construction);
    assert!(matches!(
        imported.geometry[&GeometryId::from("circle:datum")].geometry,
        Geometry::Circle(_)
    ));
    assert!(matches!(
        imported.geometry[&GeometryId::from("arc:datum")].geometry,
        Geometry::Arc(_)
    ));

    let normalized = export_dxf(&imported).unwrap();
    assert_eq!(normalized, EXPECTED);

    let reloaded = import_dxf("sketch:dxf-workload", &normalized).unwrap();
    assert_eq!(reloaded.geometry, imported.geometry);
    assert_eq!(export_dxf(&reloaded).unwrap(), normalized);
}

#[test]
fn native_curve_dxf_round_trip_does_not_tessellate_splines_ellipses_or_conics() {
    let mut sketch = Sketch::new("sketch:dxf-native");
    let values = [
        (
            "control",
            Geometry::ControlPointSpline(ControlPointSpline {
                degree: 3,
                control_points: vec![
                    Point2::new(0, 0),
                    Point2::new(10, 20),
                    Point2::new(20, 20),
                    Point2::new(30, 0),
                ],
                knots_millionths: vec![0, 0, 0, 0, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
            }),
        ),
        (
            "fit",
            Geometry::FitPointSpline(FitPointSpline {
                fit_points: vec![
                    Point2::new(0, 40),
                    Point2::new(10, 50),
                    Point2::new(20, 45),
                    Point2::new(30, 40),
                ],
            }),
        ),
        (
            "ellipse",
            Geometry::Ellipse(Ellipse {
                center: Point2::new(50, 50),
                major: Point2::new(70, 50),
                minor: Point2::new(50, 60),
            }),
        ),
        (
            "elliptical_arc",
            Geometry::EllipticalArc(EllipticalArc {
                center: Point2::new(80, 80),
                major: Point2::new(100, 80),
                minor: Point2::new(80, 90),
                start: Point2::new(100, 80),
                end: Point2::new(80, 90),
                clockwise: false,
            }),
        ),
        (
            "conic",
            Geometry::Conic(Conic {
                start: Point2::new(0, 80),
                control: Point2::new(15, 100),
                end: Point2::new(30, 80),
                weight_millionths: 750_000,
            }),
        ),
        ("point", Geometry::SketchPoint(Point2::new(7, 9))),
    ];
    for (id, geometry) in values {
        sketch
            .geometry
            .insert(id.into(), GeometryEntity::new(id, geometry));
    }
    let dxf = export_dxf(&sketch).unwrap();
    assert_eq!(dxf.matches("\nSPLINE\n").count(), 3);
    assert_eq!(dxf.matches("\nELLIPSE\n").count(), 2);
    assert!(!dxf.contains("#sample:"));
    assert!(dxf.contains("\n11\n") && dxf.contains("\n41\n0.750000000000\n"));
    let restored = import_dxf("sketch:dxf-native", &dxf).unwrap();
    assert_eq!(restored.geometry, sketch.geometry);
    let pairs = dxf.lines().collect::<Vec<_>>();
    let metadata_free = pairs
        .chunks_exact(2)
        .filter(|pair| pair[0].parse::<i32>().unwrap_or_default() < 1000)
        .flat_map(|pair| pair.iter().copied())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let standard = import_dxf("sketch:dxf-standard", &metadata_free).unwrap();
    assert!(
        matches!(standard.geometry.values().find(|entity|matches!(entity.geometry,Geometry::FitPointSpline(_))).map(|entity|&entity.geometry),Some(Geometry::FitPointSpline(value)) if value.fit_points.len()==4)
    );
    assert!(
        matches!(standard.geometry.values().find(|entity|matches!(entity.geometry,Geometry::Conic(_))).map(|entity|&entity.geometry),Some(Geometry::Conic(value)) if value.weight_millionths==750_000)
    );
    assert!(
        standard
            .geometry
            .values()
            .any(|entity| matches!(entity.geometry, Geometry::ControlPointSpline(_)))
    );
}

#[test]
fn crawler_xdata_round_trips_rectangle_identity_and_clockwise_arc_direction() {
    let mut sketch = Sketch::new("sketch:dxf-extended");
    sketch.geometry.insert(
        "rectangle:datum".into(),
        GeometryEntity::new(
            "rectangle:datum",
            Geometry::Rectangle(Rectangle {
                min: Point2::new(-2_000_000, 3_000_000),
                max: Point2::new(8_000_000, 9_000_000),
            }),
        ),
    );
    sketch.geometry.insert(
        "arc:clockwise".into(),
        GeometryEntity::new(
            "arc:clockwise",
            Geometry::Arc(Arc {
                center: Point2::new(20_000_000, 10_000_000),
                start: Point2::new(20_000_000, 15_000_000),
                end: Point2::new(25_000_000, 10_000_000),
                clockwise: true,
            }),
        ),
    );

    let exported = export_dxf(&sketch).unwrap();
    assert!(exported.contains("CRAWLER:CLOCKWISE"));
    let reloaded = import_dxf("sketch:dxf-extended", &exported).unwrap();
    assert_eq!(reloaded.geometry, sketch.geometry);
    assert_eq!(export_dxf(&reloaded).unwrap(), exported);
}
