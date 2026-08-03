$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$crate = Resolve-Path (Join-Path $root "crates/wgpu-probe")
$output = Join-Path $root "src/generated/wgpu"
wasm-pack build $crate --target web --dev --out-dir $output
