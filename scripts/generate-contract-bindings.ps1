[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$expectedVersion = 'wasm-bindgen 0.2.126'
$candidates = @()
if ($env:WASM_BINDGEN) { $candidates += $env:WASM_BINDGEN }
$command = Get-Command wasm-bindgen -ErrorAction SilentlyContinue
if ($command) { $candidates += $command.Source }
$candidates += 'E:\Temp\wasm-bindgen-0.2.126\wasm-bindgen-0.2.126-x86_64-pc-windows-msvc\wasm-bindgen.exe'
$tool = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $tool) { throw 'wasm-bindgen 0.2.126 was not found. Put it on PATH or set WASM_BINDGEN.' }
$actualVersion = (& $tool --version).Trim()
if ($actualVersion -ne $expectedVersion) {
    throw "wasm-bindgen CLI mismatch: expected '$expectedVersion', found '$actualVersion'"
}

$bindings = @(
    @{ Crate = 'crawler-kernel-worker'; Stem = 'crawler_kernel_worker'; Output = 'web\worker-spike\generated'; AppOutput = 'web\crawler-app\src\generated\kernel' },
    @{ Crate = 'crawler-render-packet'; Stem = 'crawler_render_packet'; Output = 'spikes\e00-s03-renderer\src\generated\packet' }
)

Push-Location $root
try {
    foreach ($binding in $bindings) {
        cargo build -p $binding.Crate --target wasm32-unknown-unknown --release
        if ($LASTEXITCODE -ne 0) { throw "$($binding.Crate) WASM build failed with exit code $LASTEXITCODE" }
        $metadata = cargo metadata --format-version 1 --no-deps | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) { throw "cargo metadata failed with exit code $LASTEXITCODE" }
        $input = Join-Path $metadata.target_directory "wasm32-unknown-unknown\release\$($binding.Stem).wasm"
        $output = Join-Path $root $binding.Output
        New-Item -ItemType Directory -Force -Path $output | Out-Null
        & $tool $input --target web --out-dir $output
        if ($LASTEXITCODE -ne 0) { throw "$($binding.Crate) wasm-bindgen failed with exit code $LASTEXITCODE" }
        if ($binding.AppOutput) {
            $appOutput = Join-Path $root $binding.AppOutput
            New-Item -ItemType Directory -Force -Path $appOutput | Out-Null
            Copy-Item -Path (Join-Path $output '*') -Destination $appOutput -Force
        }
    }
}
finally {
    Pop-Location
}
