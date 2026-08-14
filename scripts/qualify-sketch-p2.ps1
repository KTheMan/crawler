[CmdletBinding()]
param(
    [string]$MonstertruckCheckout = "E:\.cargo\git\checkouts\monstertruck-f028d4cff35aec58\4669392",
    [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$root = Split-Path -Parent $PSScriptRoot
$cargoDirectory = Join-Path $root ".cargo"
$cargoConfig = Join-Path $cargoDirectory "config.toml"
$createdConfig = $false
$packages = @("gpu", "mesh", "meshing", "modeling", "render", "solid", "step", "topology", "wasm")

try {
    if (-not (Test-Path -LiteralPath $cargoConfig)) {
        New-Item -ItemType Directory -Force -Path $cargoDirectory | Out-Null
        $lines = @('[patch."https://github.com/KTheMan/monstertruck.git"]')
        foreach ($package in $packages) {
            $path = (Join-Path $MonstertruckCheckout "monstertruck-$package").Replace('\', '/')
            if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Monstertruck package checkout not found: $path" }
            $lines += "monstertruck-$package = { path = `"$path`" }"
        }
        Set-Content -LiteralPath $cargoConfig -Value ($lines -join "`n") -Encoding utf8
        $createdConfig = $true
    }
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
    if ($createdConfig -and (Test-Path -LiteralPath $cargoConfig)) { Remove-Item -LiteralPath $cargoConfig -Force }
}
