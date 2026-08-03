[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output = Join-Path $root 'contracts\operation-schema\catalog.v1.json'

Push-Location $root
try {
    cargo run -p crawler-operation-schema --example generate_operation_catalog -- $output
    if ($LASTEXITCODE -ne 0) {
        throw "operation catalog generation failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
