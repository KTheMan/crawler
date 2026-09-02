[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "solid-feature-command-provenance.ps1")

$invocation = New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @(
    "-NoProfile", "-File", "scripts/example with space.ps1", "-Value", "it's deterministic"
) -SourceId "self-test:quoted-command"
if ($invocation.rerun -cne "pwsh -NoProfile -File 'scripts/example with space.ps1' -Value 'it''s deterministic'") {
    throw "Deterministic one-line rerun quoting changed: $($invocation.rerun)"
}
Assert-SolidFeatureCommandInvocation $invocation | Out-Null

foreach ($field in @("rerun", "invocation_sha256", "source_id", "working_directory")) {
    $tampered = $invocation | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    switch ($field) {
        "rerun" { $tampered.rerun = "pwsh -NoProfile -File wrong.ps1" }
        "invocation_sha256" { $tampered.invocation_sha256 = "0" * 64 }
        "source_id" { $tampered.source_id = "tampered" }
        "working_directory" { $tampered.working_directory = "subdirectory" }
    }
    $rejected = $false
    try { Assert-SolidFeatureCommandInvocation $tampered | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw "Tampered command provenance field was accepted: $field" }
}

$tamperedArgv = $invocation | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$tamperedArgv.argv[2] = "scripts/different.ps1"
$rejected = $false
try { Assert-SolidFeatureCommandInvocation $tamperedArgv | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw "Tampered command argv was accepted." }

Write-Host "Solid-feature command provenance self-tests passed." -ForegroundColor Green
