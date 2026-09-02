[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Manifest,
    [Parameter(Mandatory)] [string]$InputPath,
    [Parameter(Mandatory)] [string]$OutputPath
)

$ErrorActionPreference = "Stop"

function Escape-XmlAttribute {
    param([AllowEmptyString()] [string]$Value)
    return [Security.SecurityElement]::Escape($Value)
}

$manifestPath = [IO.Path]::GetFullPath($Manifest)
$input = [IO.Path]::GetFullPath($InputPath)
$output = [IO.Path]::GetFullPath($OutputPath)
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Browser JUnit manifest is absent: $manifestPath" }
if (-not (Test-Path -LiteralPath $input -PathType Leaf)) { throw "Raw browser JUnit is absent: $input" }

$candidate = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -Depth 100
$expected = [Collections.Generic.List[object]]::new()
foreach ($test in $candidate.tests | Where-Object { $_.kind -in @("browser", "performance") -and $_.command -match "playwright\s+test" } | Sort-Object id) {
    $matches = [regex]::Matches([string]$test.command, 'tests[/\\][^\s"'']+\.spec\.ts')
    $specs = @($matches | ForEach-Object { $_.Value.Replace('\', '/') } | Sort-Object -Unique)
    if ($specs.Count -ne 1) { throw "Manifest browser test '$($test.id)' must name exactly one Playwright spec; found $($specs.Count)." }
    $expected.Add([pscustomobject]@{ id=[string]$test.id; spec=$specs[0]; basename=[IO.Path]::GetFileName($specs[0]) })
}
if ($expected.Count -eq 0) { throw "Manifest contains no Playwright browser tests." }
$duplicateSpecs = @($expected | Group-Object basename | Where-Object Count -ne 1)
if ($duplicateSpecs.Count -gt 0) { throw "Manifest browser tests must map one-to-one to specs: $($duplicateSpecs.Name -join ', ')" }

[xml]$raw = Get-Content -LiteralPath $input -Raw
$cases = @($raw.SelectNodes("//testcase"))
if ($cases.Count -eq 0) { throw "Raw browser JUnit contains no test cases." }
if (@($raw.SelectNodes("//testcase/failure | //testcase/error | //testcase/skipped")).Count -gt 0) {
    throw "Raw browser JUnit contains failed, errored, or skipped test cases."
}

$assigned = @{}
foreach ($item in $expected) { $assigned[$item.id] = [Collections.Generic.List[object]]::new() }
foreach ($case in $cases) {
    $identity = "$($case.classname) $($case.name)".Replace('\', '/')
    $owners = @($expected | Where-Object { $identity.Contains($_.basename, [StringComparison]::Ordinal) })
    if ($owners.Count -ne 1) { throw "JUnit test case '$identity' maps to $($owners.Count) manifest browser tests; expected exactly one." }
    $assigned[$owners[0].id].Add([pscustomobject]@{ classname=[string]$case.classname; name=[string]$case.name })
}
foreach ($item in $expected) {
    if ($assigned[$item.id].Count -eq 0) { throw "Combined browser JUnit is missing manifest test '$($item.id)' ($($item.spec))." }
    $duplicates = @($assigned[$item.id] | Group-Object { "$($_.classname)`0$($_.name)" } | Where-Object Count -gt 1)
    if ($duplicates.Count -gt 0) { throw "Combined browser JUnit contains duplicate cases for '$($item.id)'." }
}

$lines = [Collections.Generic.List[string]]::new()
$total = ($assigned.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
$lines.Add('<?xml version="1.0" encoding="UTF-8"?>')
$lines.Add("<testsuites name=`"solid-feature-browser-qualification`" tests=`"$total`" failures=`"0`" errors=`"0`" skipped=`"0`">")
foreach ($item in $expected) {
    $owned = @($assigned[$item.id] | Sort-Object classname, name)
    $lines.Add("  <testsuite name=`"$(Escape-XmlAttribute $item.id)`" source_spec=`"$(Escape-XmlAttribute $item.spec)`" tests=`"$($owned.Count)`" failures=`"0`" errors=`"0`" skipped=`"0`">")
    foreach ($case in $owned) {
        $lines.Add("    <testcase classname=`"$(Escape-XmlAttribute $case.classname)`" name=`"$(Escape-XmlAttribute $case.name)`" />")
    }
    $lines.Add("  </testsuite>")
}
$lines.Add('</testsuites>')
New-Item -ItemType Directory -Force (Split-Path -Parent $output) | Out-Null
($lines -join "`n") + "`n" | Set-Content -LiteralPath $output -Encoding utf8NoBOM
Write-Host "Finalized deterministic browser JUnit for $($expected.Count) manifest test IDs: $output" -ForegroundColor Green
