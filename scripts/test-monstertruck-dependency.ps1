[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$expectedPrefix = 'git+https://github.com/KTheMan/monstertruck.git?branch=dev#'
$expectedPackages = @(
    'monstertruck-gpu',
    'monstertruck-mesh',
    'monstertruck-meshing',
    'monstertruck-modeling',
    'monstertruck-render',
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
    if (-not $package[0].source.StartsWith($expectedPrefix, [StringComparison]::Ordinal)) {
        throw "$name resolved from '$($package[0].source)' instead of the Monstertruck dev branch."
    }
}

$unexpectedSources = @($resolved | Where-Object {
    $_.source -and -not $_.source.StartsWith($expectedPrefix, [StringComparison]::Ordinal)
})
if ($unexpectedSources) {
    throw "Monstertruck packages resolved from mixed sources: $($unexpectedSources.name -join ', ')."
}

$revisions = @($resolved | Where-Object source | ForEach-Object {
    $_.source.Substring($_.source.LastIndexOf('#') + 1)
} | Sort-Object -Unique)
if ($revisions.Count -ne 1 -or $revisions[0] -notmatch '^[0-9a-f]{40}$') {
    throw "Monstertruck packages are not locked to one Git revision: $($revisions -join ', ')."
}

Write-Host "Monstertruck Git dependencies verified at $($revisions[0])." -ForegroundColor Green
