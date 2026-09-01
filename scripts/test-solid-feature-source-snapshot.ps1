[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "solid-feature-source-snapshot.ps1")

function Assert-True {
    param([Parameter(Mandatory)] [bool]$Condition, [Parameter(Mandatory)] [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Write-Utf8Text {
    param([Parameter(Mandatory)] [string]$Path, [Parameter(Mandatory)] [string]$Value)
    [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("crawler-source-snapshot-{0}" -f [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    & git -C $testRoot init --quiet
    if ($LASTEXITCODE -ne 0) { throw "Unable to initialize isolated snapshot repository." }
    & git -C $testRoot config user.name "Source Snapshot Self-Test"
    & git -C $testRoot config user.email "source-snapshot@example.invalid"
    New-Item -ItemType Directory -Path (Join-Path $testRoot "src") | Out-Null
    Write-Utf8Text (Join-Path $testRoot "src/a.txt") "base"
    Write-Utf8Text (Join-Path $testRoot "src/delete.txt") "delete-me"
    & git -C $testRoot add -- src/a.txt src/delete.txt
    & git -C $testRoot commit --quiet -m "snapshot baseline"
    if ($LASTEXITCODE -ne 0) { throw "Unable to commit isolated snapshot baseline." }

    # The old implementation failed this case: status and path remain exactly
    # the same while the content of an already-modified file changes.
    Write-Utf8Text (Join-Path $testRoot "src/a.txt") "1111"
    Write-Utf8Text (Join-Path $testRoot "src/new.txt") "aaaa"
    $statusA = @(Get-SolidFeatureSourceStatusEntries -RepositoryRoot $testRoot)
    $snapshotA = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    Write-Utf8Text (Join-Path $testRoot "src/a.txt") "2222"
    Write-Utf8Text (Join-Path $testRoot "src/new.txt") "bbbb"
    $statusB = @(Get-SolidFeatureSourceStatusEntries -RepositoryRoot $testRoot)
    $snapshotB = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    Assert-True (($statusA -join "`n") -ceq ($statusB -join "`n")) "Self-test setup did not preserve identical Git status text."
    Assert-True ($snapshotA.sha256 -cne $snapshotB.sha256) "Content changes with identical status text did not change the source snapshot."

    $beforeArtifacts = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    New-Item -ItemType Directory -Force (Join-Path $testRoot "artifacts/solid-feature-qualification/current"), (Join-Path $testRoot "artifacts/solid-feature-qualification/runs/old") | Out-Null
    Write-Utf8Text (Join-Path $testRoot "artifacts/solid-feature-qualification/current/evidence.json") '{"volatile":1}'
    Write-Utf8Text (Join-Path $testRoot "artifacts/solid-feature-qualification/runs/old/evidence.json") '{"volatile":2}'
    $afterArtifacts = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    Assert-True ($beforeArtifacts.sha256 -ceq $afterArtifacts.sha256) "Qualification artifacts changed the source snapshot."
    Assert-True ($beforeArtifacts.entry_count -eq $afterArtifacts.entry_count) "Qualification artifacts changed the source entry count."
    Assert-True (-not @($afterArtifacts.entries | Where-Object path -like "artifacts/solid-feature-qualification/*").Count) "Qualification artifacts leaked into snapshot entries."

    $beforeDelete = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    Remove-Item -LiteralPath (Join-Path $testRoot "src/delete.txt")
    $afterDelete = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    Assert-True ($beforeDelete.sha256 -cne $afterDelete.sha256) "Tracked deletion did not change the source snapshot."
    Assert-True (@($afterDelete.entries | Where-Object { $_.path -eq "src/delete.txt" -and $_.kind -eq "deleted" }).Count -eq 1) "Tracked deletion lacks a canonical deletion entry."

    $beforeRename = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    Move-Item -LiteralPath (Join-Path $testRoot "src/a.txt") -Destination (Join-Path $testRoot "src/renamed.txt")
    $afterRename = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    Assert-True ($beforeRename.sha256 -cne $afterRename.sha256) "Path rename did not change the source snapshot."

    Write-Utf8Text (Join-Path $testRoot "src/z-order.txt") "z"
    Write-Utf8Text (Join-Path $testRoot "src/a-order.txt") "a"
    $orderA = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    Remove-Item -LiteralPath (Join-Path $testRoot "src/z-order.txt"), (Join-Path $testRoot "src/a-order.txt")
    Write-Utf8Text (Join-Path $testRoot "src/a-order.txt") "a"
    Write-Utf8Text (Join-Path $testRoot "src/z-order.txt") "z"
    $orderB = Get-SolidFeatureSourceSnapshot -RepositoryRoot $testRoot
    Assert-True ($orderA.sha256 -ceq $orderB.sha256) "Filesystem creation/enumeration order changed the canonical snapshot."

    $recordPath = Join-Path $testRoot "snapshot-record.json"
    $orderB | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $recordPath -Encoding utf8NoBOM
    $schemaPath = Join-Path (Split-Path -Parent $PSScriptRoot) "contracts/solid-feature-candidate/source-snapshot.schema.json"
    Assert-True (Test-Json -LiteralPath $recordPath -SchemaFile $schemaPath) "Persisted source snapshot does not satisfy its evidence schema."
    $persisted = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json -Depth 20
    Assert-True ($persisted.entry_count -eq @($persisted.entries).Count) "Persisted source snapshot entry count is inconsistent."
    Assert-True ($persisted.file_count -eq @($persisted.entries | Where-Object kind -eq "file").Count) "Persisted source snapshot file count is inconsistent."
    Assert-True ($persisted.deleted_count -eq @($persisted.entries | Where-Object kind -eq "deleted").Count) "Persisted source snapshot deletion count is inconsistent."
    Assert-True ($persisted.sha256 -ceq (Get-SolidFeatureSnapshotManifestHash -Entries @($persisted.entries))) "Persisted source snapshot digest is not derived from its entries."

    Write-Host "Solid-feature source snapshot self-test passed." -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
