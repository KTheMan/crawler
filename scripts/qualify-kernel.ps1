[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot
$expectedKernel = "e9024ba7d6bff2b8407cd382dd584f784bfa7abe"
$expectedResources = "9bf9de1426c5fc2f2b8d63f501dca0d3c53ebd91"

function Assert-GitCommit {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Expected,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $actual = (& git -C $Path rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read the $Label commit."
    }
    if ($actual -ne $Expected) {
        throw "$Label is pinned at $actual; expected $Expected. Update the ADR and contract before promotion."
    }
}

function Assert-GitClean {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $status = (& git -C $Path status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect the $Label worktree."
    }
    if ($status) {
        throw "$Label has worktree changes. Qualification requires an unmodified pin."
    }
}

$kernelPath = Join-Path $workspace "vendor/monstertruck"
$resourcesPath = Join-Path $kernelPath "resources"
Assert-GitCommit -Path $kernelPath -Expected $expectedKernel -Label "Monstertruck kernel"
Assert-GitCommit -Path $resourcesPath -Expected $expectedResources -Label "Monstertruck resources"
Assert-GitClean -Path $kernelPath -Label "Monstertruck kernel"
Assert-GitClean -Path $resourcesPath -Label "Monstertruck resources"

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
