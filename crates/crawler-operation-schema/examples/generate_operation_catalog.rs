use crawler_operation_schema::alpha_operation_catalog;
use std::{env, fs, path::PathBuf};

fn main() {
    let output = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .expect("usage: generate_operation_catalog <output-path>");
    let mut json = serde_json::to_string_pretty(&alpha_operation_catalog())
        .expect("alpha operation catalog must serialize");
    json.push('\n');
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).expect("catalog output directory must be creatable");
    }
    fs::write(output, json).expect("alpha operation catalog must be writable");
}
