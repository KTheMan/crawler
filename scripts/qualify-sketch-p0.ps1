[CmdletBinding()]
param(
    [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$root = Split-Path -Parent $PSScriptRoot

try {
    Push-Location $root
    cargo test -p crawler-sketch --offline
    cargo test -p crawler-part-runtime p0_constraints_and_dimension_parameters_reload_and_edit_durably --offline
    & (Join-Path $root "scripts\generate-part-runtime.ps1")
    Push-Location (Join-Path $root "web\crawler-app")
    pnpm run test:unit
    pnpm run build
    if (-not $SkipBrowser) {
        pnpm exec playwright test tests/sketch-ux-lifecycle.spec.ts tests/sketch.spec.ts --reporter=line
    }
    Pop-Location
    Pop-Location
}
finally {
    while ((Get-Location).Path -ne $root -and (Get-Location).Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { Pop-Location }
}
