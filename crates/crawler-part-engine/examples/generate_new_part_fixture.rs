use crawler_document::DocumentId;
use crawler_part_engine::{NewPartCommand, PartEngine};

fn main() {
    let engine = PartEngine::new_part(NewPartCommand::cube(
        DocumentId::from("document:new-part-cube"),
        "New Part Cube",
        10_000_000,
    ))
    .expect("fixture command must be valid");
    print!(
        "{}",
        String::from_utf8(engine.canonical_document_bytes().unwrap()).unwrap()
    );
    eprintln!("sha256={}", engine.semantic_hash().unwrap());
}
