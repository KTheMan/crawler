//! Deterministic, Crawler-owned sketch model and geometric solver contract.
//!
//! Coordinates use signed nanometers and angles use signed microdegrees. The
//! public DTO stays independent of the numeric backend. A deterministic
//! entity/constraint graph frontend decomposes sketches into independent solve
//! components, which are solved by KittyCAD EZPZ in both native and WASM builds.

mod command;
mod curve;
mod decomposition;
mod dxf;
mod ezpz_backend;
mod model;
mod profile;
mod solver;

pub use command::{CommandApplication, CommandDiagnostic, SketchCommand, TrimOperation};
pub use curve::{
    CurveBounds, CurveFrame, CurveIntersection, CurveProjection, MAX_CERT_DEPTH,
    MAX_CERTIFICATION_NODES, MAX_OFFSET_SPANS_PER_SOURCE_SIDE, OFFSET_MODEL_TOLERANCE_NM,
    OffsetCurveError, OffsetCurvePiece, curve_bounds, evaluate_curve, evaluate_frame,
    intersect_curves, offset_curve, offset_curve_with_intervals, offset_curve_with_tolerance,
    offset_generation_call_count, project_point, reset_offset_generation_call_count, split_curve,
};
pub use decomposition::{Decomposition, GraphDecompositionFrontend, SolveComponent};
pub use dxf::{DxfError, export_dxf, import_dxf};
pub use model::{
    Anchor, Arc, Axis2d, Circle, Conic, Constraint, ConstraintId, ControlPointSpline, Ellipse,
    EllipticalArc, FitPointSpline, Geometry, GeometryEntity, GeometryId,
    IMPLIED_ORIGIN_GEOMETRY_ID, Line, OffsetResultSpan, Point2, PointRef, Rectangle, Sketch,
    SketchError, SketchOperation, SketchRecipe,
};
pub use profile::{ProfileDiagnostic, ProfileReport};
pub use solver::{
    ConflictReason, ConflictSet, ConstrainedDragResult, DragRequest, EzpzSolver, SketchSolver,
    SolveResult, SolveState, SolvedSketch, SolverContract,
};
