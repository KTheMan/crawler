[CmdletBinding()]
param(
    [string]$Manifest = "contracts/solid-feature-candidate/sprint-1.json",
    [string]$EvidenceRoot = "artifacts/solid-feature-qualification/current",
    [ValidateSet("native", "release-wasm", "all")]
    [string]$Runtime = "all"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$manifestPath = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($Manifest)) { $Manifest } else { Join-Path $repo $Manifest }))
$evidencePath = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($EvidenceRoot)) { $EvidenceRoot } else { Join-Path $repo $EvidenceRoot }))
$nativePath = Join-Path $evidencePath "runtime/native"
$wasmPath = Join-Path $evidencePath "runtime/release-wasm"
$recordedAt = (Get-Date).ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)

Push-Location $repo
try {
    if ($Runtime -in @("native", "all")) {
        cargo run --quiet --locked -p crawler-part-runtime --example solid_feature_evidence -- `
            --manifest $manifestPath --output $nativePath --recorded-at $recordedAt
        if ($LASTEXITCODE -ne 0) { throw "Native evidence exporter failed with exit code $LASTEXITCODE." }
        node scripts/validate-solid-feature-evidence.mjs --manifest $manifestPath --evidence $nativePath --runtime native
        if ($LASTEXITCODE -ne 0) { throw "Native fixture-oracle validation failed with exit code $LASTEXITCODE." }
    }

    if ($Runtime -in @("release-wasm", "all")) {
        node scripts/export-solid-feature-wasm-evidence.mjs `
            --manifest $manifestPath --output $wasmPath
        if ($LASTEXITCODE -ne 0) { throw "Release-WASM evidence exporter failed with exit code $LASTEXITCODE." }
        node scripts/validate-solid-feature-evidence.mjs --manifest $manifestPath --evidence $wasmPath --runtime release_wasm
        if ($LASTEXITCODE -ne 0) { throw "Release-WASM fixture-oracle validation failed with exit code $LASTEXITCODE." }
    }

    if ($Runtime -eq "all") {
        node scripts/compare-solid-feature-parity.mjs `
            --manifest $manifestPath `
            --native $nativePath `
            --wasm $wasmPath `
            --output (Join-Path $evidencePath "parity/parity.json") `
            --junit (Join-Path $evidencePath "parity/parity.junit.xml")
        if ($LASTEXITCODE -ne 0) { throw "Native/release-WASM parity failed with exit code $LASTEXITCODE." }
    }
}
finally {
    Pop-Location
}
