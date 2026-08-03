$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$crate = Resolve-Path (Join-Path $root "../../crates/crawler-render-packet")
$output = Join-Path $root "src/generated/packet"
wasm-pack build $crate --target web --dev --out-dir $output
