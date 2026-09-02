[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output = Join-Path $root 'contracts\operation-schema\catalog.v1.json'

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
    $stagingBase = [IO.Path]::GetFullPath((Join-Path $root 'target\operation-catalog-staging'))
    $staging = [IO.Path]::GetFullPath((Join-Path $stagingBase ("catalog-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N'))))
    if (-not $staging.StartsWith($stagingBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "operation catalog staging path escaped its target root: $staging"
    }
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    try {
        $stagedOutput = Join-Path $staging 'catalog.v1.json'
        cargo run -p crawler-operation-schema --example generate_operation_catalog -- $stagedOutput
        if ($LASTEXITCODE -ne 0) {
            throw "operation catalog generation failed with exit code $LASTEXITCODE"
        }
        Copy-GeneratedFileWithRetry -Source $stagedOutput -Destination $output
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
