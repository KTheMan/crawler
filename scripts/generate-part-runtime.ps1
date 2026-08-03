[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$expectedVersion = 'wasm-bindgen 0.2.126'
$candidates = @()
if ($env:WASM_BINDGEN) {
    $candidates += $env:WASM_BINDGEN
}
$command = Get-Command wasm-bindgen -ErrorAction SilentlyContinue
if ($command) {
    $candidates += $command.Source
}
$candidates += 'E:\Temp\wasm-bindgen-0.2.126\wasm-bindgen-0.2.126-x86_64-pc-windows-msvc\wasm-bindgen.exe'
$tool = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $tool) {
    throw "wasm-bindgen 0.2.126 was not found. Put it on PATH or set WASM_BINDGEN to the executable."
}
$actualVersion = (& $tool --version).Trim()
if ($actualVersion -ne $expectedVersion) {
    throw "wasm-bindgen CLI mismatch: expected '$expectedVersion', found '$actualVersion'"
}

Push-Location $root
try {
    cargo build -p crawler-part-runtime --release --target wasm32-unknown-unknown
    if ($LASTEXITCODE -ne 0) {
        throw "crawler-part-runtime release WASM build failed with exit code $LASTEXITCODE"
    }
    $metadata = cargo metadata --format-version 1 --no-deps | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) {
        throw "cargo metadata failed with exit code $LASTEXITCODE"
    }
    $input = Join-Path $metadata.target_directory 'wasm32-unknown-unknown\release\crawler_part_runtime.wasm'
    $output = Join-Path $root 'web\crawler-app\src\generated\runtime'
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    & $tool $input --target web --out-dir $output
    if ($LASTEXITCODE -ne 0) {
        throw "wasm-bindgen generation failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
