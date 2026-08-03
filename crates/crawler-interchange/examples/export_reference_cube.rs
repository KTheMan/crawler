use crawler_interchange::{ExportFormat, export_part};
use crawler_part_engine::{NewPartCommand, PartEngine};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = std::env::args_os().nth(1).ok_or(
        "usage: cargo run -p crawler-interchange --example export_reference_cube -- <output.step>",
    )?;
    let engine = PartEngine::new_part(NewPartCommand::cube(
        "document:step-brep-reference-cube",
        "STEP B-rep Reference Cube",
        10_000_000,
    ))?;
    let artifact = export_part(&engine, ExportFormat::Step)?;
    std::fs::write(output, artifact.bytes)?;
    Ok(())
}
