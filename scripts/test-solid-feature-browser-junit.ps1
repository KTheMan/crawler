[CmdletBinding()]
param(
    [string]$Manifest = "contracts/solid-feature-candidate/sprint-1.json"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestPath = if ([IO.Path]::IsPathRooted($Manifest)) { $Manifest } else { Join-Path $root $Manifest }
$finalizer = Join-Path $PSScriptRoot "finalize-solid-feature-browser-junit.ps1"
$candidate = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -Depth 100
$expected = @($candidate.tests |
    Where-Object { $_.kind -in @("browser", "performance") -and $_.command -match "playwright\s+test" } |
    Sort-Object id |
    ForEach-Object {
        $specs = @([regex]::Matches([string]$_.command, 'tests[/\\][^\s"'']+\.spec\.ts') |
            ForEach-Object { $_.Value.Replace('\', '/') } | Sort-Object -Unique)
        if ($specs.Count -ne 1) { throw "Fixture manifest test '$($_.id)' does not own exactly one spec." }
        [pscustomobject]@{ id = [string]$_.id; spec = $specs[0]; basename = [IO.Path]::GetFileName($specs[0]) }
    })
if ($expected.Count -lt 2) { throw "The browser JUnit test requires at least two manifest browser specs." }

function Write-RawJunit {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [object[]]$Items,
        [switch]$Failed
    )
    $lines = [Collections.Generic.List[string]]::new()
    $lines.Add('<?xml version="1.0" encoding="UTF-8"?>')
    $lines.Add('<testsuites>')
    foreach ($item in $Items) {
        $lines.Add("  <testsuite name=`"raw-$($item.id)`" timestamp=`"2099-01-01T00:00:00Z`">")
        $lines.Add("    <testcase classname=`"$($item.basename)`" name=`"qualifies $($item.id)`">")
        if ($Failed -and $item.id -eq $Items[0].id) { $lines.Add('      <failure message="deliberate failure" />') }
        $lines.Add('    </testcase>')
        $lines.Add('  </testsuite>')
    }
    $lines.Add('</testsuites>')
    ($lines -join "`n") + "`n" | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}

function Invoke-Finalizer {
    param([string]$InputPath, [string]$OutputPath)
    & pwsh -NoProfile -File $finalizer -Manifest $manifestPath -InputPath $InputPath -OutputPath $OutputPath *> $null
    return $LASTEXITCODE
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) "crawler-solid-feature-browser-junit-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $raw = Join-Path $temporary "raw.xml"
    $first = Join-Path $temporary "first.xml"
    $second = Join-Path $temporary "second.xml"
    Write-RawJunit -Path $raw -Items $expected
    if ((Invoke-Finalizer $raw $first) -ne 0 -or (Invoke-Finalizer $raw $second) -ne 0) {
        throw "A complete raw JUnit report did not finalize."
    }
    if ((Get-FileHash -LiteralPath $first -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $second -Algorithm SHA256).Hash) {
        throw "Identical raw JUnit input did not produce byte-identical canonical output."
    }

    [xml]$canonical = Get-Content -LiteralPath $first -Raw
    $suites = @($canonical.testsuites.testsuite)
    $expectedIds = @($expected.id)
    $actualIds = @($suites | ForEach-Object { [string]$_.name })
    if (($expectedIds -join "`n") -cne ($actualIds -join "`n")) { throw "Canonical suite order or manifest IDs differ." }
    foreach ($suite in $suites) {
        $owned = $expected | Where-Object id -eq ([string]$suite.name)
        if ([string]$suite.source_spec -cne $owned.spec -or [int]$suite.tests -ne 1 -or @($suite.testcase).Count -ne 1) {
            throw "Canonical suite '$($suite.name)' lacks its deterministic manifest identity."
        }
    }

    $missingRaw = Join-Path $temporary "missing.xml"
    Write-RawJunit -Path $missingRaw -Items @($expected | Select-Object -SkipLast 1)
    if ((Invoke-Finalizer $missingRaw (Join-Path $temporary "missing-output.xml")) -eq 0) {
        throw "A raw JUnit report missing a manifest browser test was accepted."
    }

    $failedRaw = Join-Path $temporary "failed.xml"
    Write-RawJunit -Path $failedRaw -Items $expected -Failed
    if ((Invoke-Finalizer $failedRaw (Join-Path $temporary "failed-output.xml")) -eq 0) {
        throw "A raw JUnit report with a failed test case was accepted."
    }

    $unexpectedRaw = Join-Path $temporary "unexpected.xml"
    Write-RawJunit -Path $unexpectedRaw -Items @($expected + [pscustomobject]@{ id = "unexpected"; basename = "unexpected.spec.ts" })
    if ((Invoke-Finalizer $unexpectedRaw (Join-Path $temporary "unexpected-output.xml")) -eq 0) {
        throw "A raw JUnit report with an unowned test case was accepted."
    }
}
finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force
}

Write-Host "Deterministic combined browser JUnit positive and negative tests passed." -ForegroundColor Green
