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

foreach ($package in $packages) {
    $path = Join-Path $MonstertruckCheckout "monstertruck-$package"
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw "Monstertruck package checkout not found: $path. Pass -MonstertruckCheckout with the pinned 4669392 checkout."
    }
}

try {
    if (-not (Test-Path -LiteralPath $cargoConfig)) {
        New-Item -ItemType Directory -Force -Path $cargoDirectory | Out-Null
        $lines = @('[patch."https://github.com/KTheMan/monstertruck.git"]')
        foreach ($package in $packages) {
            $path = (Join-Path $MonstertruckCheckout "monstertruck-$package").Replace('\', '/')
            $lines += "monstertruck-$package = { path = `"$path`" }"
        }
        Set-Content -LiteralPath $cargoConfig -Value ($lines -join "`n") -Encoding utf8
        $createdConfig = $true
    }

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
    if ($createdConfig -and (Test-Path -LiteralPath $cargoConfig)) { Remove-Item -LiteralPath $cargoConfig -Force }
}
