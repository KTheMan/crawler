[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$BundleRoot,
    [string[]]$AllowUnchecksummedPath = @()
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "solid-feature-command-provenance.ps1")
$bundle = (Resolve-Path -LiteralPath $BundleRoot).Path
$bundlePrefix = $bundle.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

function Resolve-BundlePath {
    param([Parameter(Mandatory)] [string]$RelativePath)
    if ([IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -eq ".") {
        throw "Bundle evidence path must name a bundle-relative artifact: $RelativePath"
    }
    $full = [IO.Path]::GetFullPath((Join-Path $bundle $RelativePath))
    if (-not $full.StartsWith($bundlePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Bundle evidence path escapes the immutable run: $RelativePath"
    }
    if (-not (Test-Path -LiteralPath $full)) { throw "Bundle evidence path is absent: $RelativePath" }
    return $full
}

foreach ($required in @("run-metadata.json", "qualification-report.json", "SHA256SUMS.json", "records")) {
    if (-not (Test-Path -LiteralPath (Join-Path $bundle $required))) { throw "Bundle is missing $required" }
}

$checksums = Get-Content -LiteralPath (Join-Path $bundle "SHA256SUMS.json") -Raw | ConvertFrom-Json -Depth 20
$checksumByPath = @{}
foreach ($entry in @($checksums.files)) {
    $path = [string]$entry.path
    if ($checksumByPath.ContainsKey($path)) { throw "Duplicate checksum path: $path" }
    $full = Resolve-BundlePath $path
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Checksum path is not a file: $path" }
    $actualHash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
    $actualBytes = (Get-Item -LiteralPath $full).Length
    if ($actualHash -ne [string]$entry.sha256 -or $actualBytes -ne [int64]$entry.bytes) {
        throw "Checksum mismatch: $path"
    }
    $checksumByPath[$path] = $entry
}

$uncheckedFiles = @(Get-ChildItem -LiteralPath $bundle -Recurse -File |
    ForEach-Object { [IO.Path]::GetRelativePath($bundle, $_.FullName).Replace('\', '/') } |
    Where-Object { $_ -ne "SHA256SUMS.json" -and $_ -notin $AllowUnchecksummedPath -and -not $checksumByPath.ContainsKey($_) })
if ($uncheckedFiles.Count -gt 0) { throw "Bundle contains unchecked files: $($uncheckedFiles -join ', ')" }

$metadata = Get-Content -LiteralPath (Join-Path $bundle "run-metadata.json") -Raw | ConvertFrom-Json -Depth 100
$report = Get-Content -LiteralPath (Join-Path $bundle "qualification-report.json") -Raw | ConvertFrom-Json -Depth 100
$manifestCandidates = @(Get-ChildItem -LiteralPath (Resolve-BundlePath "inputs/contracts/solid-feature-candidate") -File -Filter "*.json" |
    Where-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -eq [string]$metadata.manifest_sha256 })
if ($manifestCandidates.Count -ne 1) {
    throw "Bundle must contain exactly one candidate manifest matching run metadata; found $($manifestCandidates.Count)."
}
$manifestPath = $manifestCandidates[0].FullName
$manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -Depth 100
$manifestRepositoryPath = [IO.Path]::GetRelativePath((Join-Path $bundle "inputs"), $manifestPath).Replace('\', '/')
if ($manifestHash -ne $metadata.manifest_sha256 -or $manifestHash -ne $report.manifest_sha256) {
    throw "The materialized manifest does not match run metadata/report."
}
if ($report.status -ne "passed" -or $report.evidence_root -ne ".") {
    throw "Qualification report is not a portable passed report."
}

$wasmArtifact = @($manifest.artifacts | Where-Object id -eq "release-runtime-wasm")
if ($wasmArtifact.Count -ne 1 -or -not $wasmArtifact[0].lock_required) { throw "Manifest has no unique locked release WASM." }
$wasmRelative = "inputs/$($wasmArtifact[0].path)"
$wasmPath = Resolve-BundlePath $wasmRelative
$wasmHash = (Get-FileHash -LiteralPath $wasmPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($wasmHash -ne $manifest.runtime_lock.wasm_sha256 -or $wasmHash -ne $wasmArtifact[0].expected_sha256) {
    throw "Materialized release WASM does not match the candidate lock."
}

foreach ($fixture in @($manifest.fixtures)) {
    $descriptorRelative = "inputs/$($fixture.path)"
    Resolve-BundlePath $descriptorRelative | Out-Null
    if (-not $checksumByPath.ContainsKey($descriptorRelative)) {
        throw "Fixture descriptor is not checksummed in the bundle: $($fixture.id)"
    }
}

$legacyMatrixPath = Resolve-BundlePath "inputs/contracts/solid-feature-candidate/legacy-solid-feature-matrix.v1.json"
$legacyMatrix = Get-Content -LiteralPath $legacyMatrixPath -Raw | ConvertFrom-Json -Depth 20
foreach ($legacyEvidence in @($legacyMatrix.evidence)) {
    $legacyRelative = "inputs/$legacyEvidence"
    Resolve-BundlePath $legacyRelative | Out-Null
    if (-not $checksumByPath.ContainsKey($legacyRelative)) {
        throw "Legacy golden evidence is not checksummed in the bundle: $legacyEvidence"
    }
}

$commands = @(Get-Content -LiteralPath (Join-Path $bundle "commands.json") -Raw | ConvertFrom-Json -Depth 100)
if ($commands.Count -eq 0) { throw "Bundle has no command ledger." }
$commandIds = @($commands | ForEach-Object { [string]$_.id })
if (@($commandIds | Sort-Object -Unique).Count -ne $commandIds.Count) { throw "Bundle command ledger contains duplicate command IDs." }
foreach ($command in $commands) {
    if ([int]$command.exit_code -ne 0) { throw "Bundle command did not pass: $($command.id)" }
    $invocations = @($command.invocations)
    if ($invocations.Count -eq 0) { throw "Bundle command has no structured invocation: $($command.id)" }
    foreach ($invocation in $invocations) { Assert-SolidFeatureCommandInvocation $invocation | Out-Null }
    $expectedStepRerun = @($invocations | ForEach-Object { [string]$_.rerun }) -join '; '
    if ([string]$command.rerun -cne $expectedStepRerun) { throw "Bundle command rerun does not match its structured invocations: $($command.id)" }
    $logRelative = [string]$command.log
    $logPath = Resolve-BundlePath $logRelative
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf) -or -not $checksumByPath.ContainsKey($logRelative)) {
        throw "Bundle command log is not a checksummed bundle-relative file: $($command.id)"
    }
}

if ([string]$metadata.command_ledger_path -cne "commands.json") { throw "Run metadata does not bind its command ledger path." }
Assert-SolidFeatureCommandInvocation $metadata.qualification_invocation | Out-Null
if ([string]$metadata.qualification_rerun -cne [string]$metadata.qualification_invocation.rerun) {
    throw "Run metadata qualification rerun is not derived from its structured invocation."
}
$expectedNative = New-SolidFeatureCommandInvocation -Executable "cargo" -Argv @(
    "run", "-p", "crawler-part-runtime", "--example", "solid_feature_evidence", "--",
    "--manifest", $manifestRepositoryPath,
    "--output", "artifacts/solid-feature-qualification/current/runtime/native"
) -SourceId "qualification:native-evidence"
$expectedWasm = New-SolidFeatureCommandInvocation -Executable "node" -Argv @(
    "scripts/export-solid-feature-wasm-evidence.mjs",
    "--manifest", $manifestRepositoryPath,
    "--output", "artifacts/solid-feature-qualification/current/runtime/release-wasm",
    "--module", "web/crawler-app/src/generated/runtime/crawler_part_runtime.js",
    "--wasm", "web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm"
) -SourceId "qualification:wasm-evidence"
$expectedQualification = New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @(
    "-NoProfile", "-File", "scripts/qualify-solid-features.ps1",
    "-Manifest", $manifestRepositoryPath,
    "-NativeEvidenceCommand", $expectedNative.rerun,
    "-WasmEvidenceCommand", $expectedWasm.rerun
) -SourceId "qualification:entrypoint"
if ([string]$metadata.qualification_invocation.invocation_sha256 -cne [string]$expectedQualification.invocation_sha256) {
    throw "Run metadata qualification invocation is not the deterministic manifest-bound entrypoint."
}
$expectedPreflight = @(
    (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @(
        "-NoProfile", "-File", "scripts/test-solid-feature-candidate.ps1", "-Manifest", $manifestRepositoryPath
    ) -SourceId "qualification:preflight-candidate-structure"),
    (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @(
        "-NoProfile", "-File", "scripts/test-solid-feature-candidate.ps1", "-Manifest", $manifestRepositoryPath, "-ArtifactReady"
    ) -SourceId "qualification:preflight-artifact-lock")
)
$expectedValidation = @(
    (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @(
        "-NoProfile", "-File", "scripts/test-solid-feature-candidate.ps1", "-Manifest", $manifestRepositoryPath,
        "-EvidenceRoot", "artifacts/solid-feature-qualification/current", "-CompletenessPreflight"
    ) -SourceId "qualification:completeness-preflight"),
    (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @(
        "-NoProfile", "-File", "scripts/test-solid-feature-candidate.ps1", "-Manifest", $manifestRepositoryPath,
        "-EvidenceRoot", "artifacts/solid-feature-qualification/current", "-QualificationReady"
    ) -SourceId "qualification:qualification-ready")
)
foreach ($set in @(
    [ordered]@{ label="preflight"; actual=@($metadata.preflight_invocations); expected=$expectedPreflight },
    [ordered]@{ label="validation"; actual=@($metadata.validation_invocations); expected=$expectedValidation }
)) {
    if ($set.actual.Count -ne $set.expected.Count) { throw "Run metadata $($set.label) invocation count changed." }
    for ($index = 0; $index -lt $set.expected.Count; $index++) {
        Assert-SolidFeatureCommandInvocation $set.actual[$index] | Out-Null
        if ([string]$set.actual[$index].invocation_sha256 -cne [string]$set.expected[$index].invocation_sha256) {
            throw "Run metadata $($set.label) invocation is not the deterministic command at index $index."
        }
    }
}
$expectedProbes = [ordered]@{
    git = New-SolidFeatureCommandInvocation -Executable "git" -Argv @("rev-parse", "HEAD") -SourceId "qualification:identity-git"
    rustc = New-SolidFeatureCommandInvocation -Executable "rustc" -Argv @("--version") -SourceId "qualification:identity-rustc"
    cargo = New-SolidFeatureCommandInvocation -Executable "cargo" -Argv @("--version") -SourceId "qualification:identity-cargo"
    node = New-SolidFeatureCommandInvocation -Executable "node" -Argv @("--version") -SourceId "qualification:identity-node"
    pnpm = New-SolidFeatureCommandInvocation -Executable "pnpm" -Argv @("--dir", "web/crawler-app", "--version") -SourceId "qualification:identity-pnpm"
}
foreach ($name in $expectedProbes.Keys) {
    $actualProbe = $metadata.identity_probe_invocations.$name
    Assert-SolidFeatureCommandInvocation $actualProbe | Out-Null
    if ([string]$actualProbe.invocation_sha256 -cne [string]$expectedProbes[$name].invocation_sha256) {
        throw "Run metadata identity probe changed: $name"
    }
}
$immutableRunId = [string]$metadata.immutable_run_id
if ($immutableRunId -notmatch '^\d{8}T\d{6}Z-[A-Za-z0-9_.-]+-r[1-9][0-9]*$') {
    throw "Run metadata immutable run ID is absent or malformed."
}
$expectedPostCopyValidation = New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @(
    "-NoProfile", "-File", "scripts/test-solid-feature-qualification-bundle.ps1",
    "-BundleRoot", "artifacts/solid-feature-qualification/runs/$immutableRunId"
) -SourceId "qualification:post-copy-bundle-integrity"
Assert-SolidFeatureCommandInvocation $metadata.post_copy_validation_invocation | Out-Null
if ([string]$metadata.post_copy_validation_invocation.invocation_sha256 -cne [string]$expectedPostCopyValidation.invocation_sha256) {
    throw "Run metadata post-copy validation is not the exact immutable-bundle command."
}
foreach ($exporter in @(
    [ordered]@{ id="native-evidence"; metadata=$metadata.runtime_export_invocations.native; expected=$expectedNative },
    [ordered]@{ id="wasm-evidence"; metadata=$metadata.runtime_export_invocations.wasm; expected=$expectedWasm }
)) {
    Assert-SolidFeatureCommandInvocation $exporter.metadata | Out-Null
    if ([string]$exporter.metadata.invocation_sha256 -cne [string]$exporter.expected.invocation_sha256) {
        throw "Run metadata exporter invocation is not the manifest-bound command: $($exporter.id)"
    }
    $ledgerEntry = @($commands | Where-Object id -eq $exporter.id)
    if ($ledgerEntry.Count -ne 1 -or @($ledgerEntry[0].invocations).Count -ne 1 -or
        [string]$ledgerEntry[0].invocations[0].invocation_sha256 -cne [string]$exporter.expected.invocation_sha256) {
        throw "Command ledger exporter invocation does not match run metadata and the manifest-bound command: $($exporter.id)"
    }
}

$records = @(Get-ChildItem -LiteralPath (Join-Path $bundle "records") -File -Filter "*.json")
if ($records.Count -eq 0) { throw "Bundle has no qualification records." }
foreach ($recordFile in $records) {
    $record = Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json -Depth 100
    if ($record.candidate_id -ne $manifest.candidate_id -or [int]$record.candidate_revision -ne [int]$manifest.revision -or
        $record.manifest_sha256 -ne $manifestHash -or $record.status -ne "passed") {
        throw "Stale or failed qualification record: $($recordFile.Name)"
    }
    foreach ($relative in @($record.evidence_paths)) {
        if ($relative -match '^(artifacts/solid-feature-qualification/current|web/|contracts/)') {
            throw "Record resolves outside its bundle: $($recordFile.Name): $relative"
        }
        $full = Resolve-BundlePath $relative
        if (Test-Path -LiteralPath $full -PathType Leaf) {
            if ($relative -ne "SHA256SUMS.json" -and -not $checksumByPath.ContainsKey($relative)) {
                throw "Record references an unchecked file: $($recordFile.Name): $relative"
            }
        } else {
            $children = @(Get-ChildItem -LiteralPath $full -Recurse -File)
            if ($children.Count -eq 0) { throw "Record references an empty evidence directory: $($recordFile.Name): $relative" }
            foreach ($child in $children) {
                $childRelative = [IO.Path]::GetRelativePath($bundle, $child.FullName).Replace('\', '/')
                if ($childRelative -ne "SHA256SUMS.json" -and -not $checksumByPath.ContainsKey($childRelative)) {
                    throw "Record directory contains an unchecked file: $($recordFile.Name): $childRelative"
                }
            }
        }
    }
    if ($record.subject_kind -eq "artifact") {
        $bundlePath = [string]$record.details.bundle_path
        if ([string]::IsNullOrWhiteSpace($bundlePath) -or $bundlePath -notin @($record.evidence_paths)) {
            throw "Artifact record lacks an evidence-owned bundle path: $($recordFile.Name)"
        }
        if ($null -ne $record.details.manifest_path) {
            throw "Artifact record retains a mutable manifest_path: $($recordFile.Name)"
        }
    }
}

Write-Host "Validated isolated qualification bundle: $($records.Count) records, $($checksumByPath.Count) checksummed files." -ForegroundColor Green
