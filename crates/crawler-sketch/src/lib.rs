//! Deterministic, Crawler-owned sketch model and geometric solver.
//!
//! Coordinates use signed nanometers and angles use signed microdegrees. The
//! solver enforces constraints on an integer nanometer grid without relying on
//! a geometry-kernel dependency.

mod command;
mod model;
mod profile;
mod solver;

pub use command::{CommandApplication, CommandDiagnostic, SketchCommand, TrimOperation};
pub use model::{
    Anchor, Arc, Circle, Constraint, ConstraintId, Geometry, GeometryEntity, GeometryId, Line,
    Point2, PointRef, Rectangle, Sketch, SketchError,
};
pub use profile::{ProfileDiagnostic, ProfileReport};
pub use solver::{
    ConflictReason, ConflictSet, ConstrainedDragResult, DeclarativeSolver, DragRequest,
    SketchSolver, SolveResult, SolveState, SolvedSketch,
};
