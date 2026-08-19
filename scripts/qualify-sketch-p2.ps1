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
    if ($LASTEXITCODE -ne 0) { throw "crawler-sketch P2 tests failed ($LASTEXITCODE)" }
    cargo test -p crawler-part-runtime p2_text_and_creation_recipe_metadata_commit_reload_edit_and_explode --offline
    if ($LASTEXITCODE -ne 0) { throw "crawler-part-runtime P2 persistence test failed ($LASTEXITCODE)" }
    & (Join-Path $root "scripts\generate-part-runtime.ps1")
    Push-Location (Join-Path $root "web\crawler-app")
    pnpm run test:unit
    if ($LASTEXITCODE -ne 0) { throw "browser unit tests failed ($LASTEXITCODE)" }
    pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "production build failed ($LASTEXITCODE)" }
    if (-not $SkipBrowser) {
        pnpm exec playwright test tests/sketch-p2.spec.ts tests/sketch-ux-lifecycle.spec.ts tests/sketch.spec.ts --reporter=line
        if ($LASTEXITCODE -ne 0) { throw "P2 browser workflow failed ($LASTEXITCODE)" }
    }
    Pop-Location
    Pop-Location
}
finally {
    while ((Get-Location).Path -ne $root -and (Get-Location).Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { Pop-Location }
}
