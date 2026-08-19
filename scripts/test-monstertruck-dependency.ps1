[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$expectedVersion = '0.4.0'
$expectedSource = 'registry+https://github.com/rust-lang/crates.io-index'
$expectedPackages = @(
    'monstertruck-mesh',
    'monstertruck-meshing',
    'monstertruck-modeling',
    'monstertruck-solid',
    'monstertruck-step',
    'monstertruck-topology',
    'monstertruck-wasm'
)

Push-Location $root
try {
    $metadataJson = & cargo metadata --format-version 1 --locked
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to resolve the locked Cargo dependency graph.'
    }
}
finally {
    Pop-Location
}

$metadata = $metadataJson | ConvertFrom-Json
$resolved = @($metadata.packages | Where-Object { $_.name -like 'monstertruck-*' })
foreach ($name in $expectedPackages) {
    $package = @($resolved | Where-Object name -eq $name)
    if ($package.Count -ne 1) {
        throw "Expected exactly one resolved $name package; found $($package.Count)."
    }
    if ($package[0].version -ne $expectedVersion) {
        throw "$name resolved at version '$($package[0].version)' instead of the qualified $expectedVersion release."
    }
    if ($package[0].source -ne $expectedSource) {
        throw "$name resolved from '$($package[0].source)' instead of the official crates.io registry."
    }
}

$unexpectedSources = @($resolved | Where-Object {
    $_.source -ne $expectedSource -or $_.version -ne $expectedVersion
})
if ($unexpectedSources) {
    throw "Monstertruck packages resolved from mixed versions or sources: $($unexpectedSources.name -join ', ')."
}

Write-Host "Official Monstertruck crates verified at release $expectedVersion." -ForegroundColor Green
