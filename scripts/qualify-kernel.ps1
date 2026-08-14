[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'test-monstertruck-dependency.ps1')

Push-Location $workspace
try {
    $env:CARGO_TARGET_DIR = Join-Path $workspace "target/kernel-baseline"

    & cargo test -p crawler-kernel-baseline --test kernel_contract
    if ($LASTEXITCODE -ne 0) {
        throw "Native kernel contract failed."
    }

    & cargo test -p crawler-kernel-baseline --target wasm32-unknown-unknown --test kernel_contract --no-run
    if ($LASTEXITCODE -ne 0) {
        throw "WASM kernel contract compilation failed."
    }
}
finally {
    Pop-Location
}
