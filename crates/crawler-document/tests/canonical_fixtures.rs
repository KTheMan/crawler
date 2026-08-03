use crawler_document::Document;

fn assert_canonical(fixture: &str) {
    let document: Document =
        serde_json::from_str(fixture.trim_end()).expect("fixture must deserialize");
    let canonical = serde_json::to_string(&document).expect("document must serialize");
    assert_eq!(format!("{canonical}\n"), fixture);
}

#[test]
fn minimal_document_round_trips_canonically() {
    assert_canonical(include_str!("fixtures/minimal-document.json"));
}

#[test]
fn parametric_block_round_trips_canonically() {
    assert_canonical(include_str!("fixtures/parametric-block.json"));
}

#[test]
fn new_part_cube_round_trips_canonically() {
    assert_canonical(include_str!("fixtures/new-part-cube.json"));
}
