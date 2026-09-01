[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$expectedVersion = 'wasm-bindgen 0.2.127'
$candidates = @()
if ($env:WASM_BINDGEN) {
    $candidates += $env:WASM_BINDGEN
}
$command = Get-Command wasm-bindgen -ErrorAction SilentlyContinue
if ($command) {
    $candidates += $command.Source
}
$candidates += 'E:\Temp\wasm-bindgen-cli-0.2.127\bin\wasm-bindgen.exe'
$tool = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $tool) {
    throw "wasm-bindgen 0.2.127 was not found. Put it on PATH or set WASM_BINDGEN to the executable."
}
$actualVersion = (& $tool --version).Trim()
if ($actualVersion -ne $expectedVersion) {
    throw "wasm-bindgen CLI mismatch: expected '$expectedVersion', found '$actualVersion'"
}

function Copy-GeneratedFileWithRetry {
    param([Parameter(Mandatory)] [string]$Source, [Parameter(Mandatory)] [string]$Destination)
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
            return
        }
        catch {
            if ($attempt -eq 30) { throw }
            Start-Sleep -Milliseconds 500
        }
    }
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
    $stagingBase = [IO.Path]::GetFullPath((Join-Path $root 'target\wasm-bindgen-staging'))
    $staging = [IO.Path]::GetFullPath((Join-Path $stagingBase ("runtime-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N'))))
    if (-not $staging.StartsWith($stagingBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "WASM binding staging path escaped its target root: $staging"
    }
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    try {
        & $tool $input --target web --out-dir $staging
        if ($LASTEXITCODE -ne 0) {
            throw "wasm-bindgen generation failed with exit code $LASTEXITCODE"
        }
        Get-ChildItem -LiteralPath $staging -File | ForEach-Object {
            Copy-GeneratedFileWithRetry -Source $_.FullName -Destination (Join-Path $output $_.Name)
        }
    }
    finally {
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force
        }
    }
}
finally {
    Pop-Location
}
