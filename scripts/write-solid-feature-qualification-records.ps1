[CmdletBinding()]
param(
    [string]$Manifest = "contracts/solid-feature-candidate/sprint-1.json",
    [string]$EvidenceRoot = "artifacts/solid-feature-qualification/current"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Resolve-RepoEvidencePath {
    param([Parameter(Mandatory)] [string]$Path, [switch]$NonEmptyDirectory)
    $candidate = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $root $Path }
    $full = [IO.Path]::GetFullPath($candidate)
    $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($full -ne $root -and -not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Evidence path escapes the repository: $Path"
    }
    if (-not (Test-Path -LiteralPath $full)) { throw "Evidence path is absent: $Path" }
    if ($NonEmptyDirectory) {
        if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "Expected an evidence directory: $Path" }
        if (-not (Get-ChildItem -LiteralPath $full -Recurse -File | Select-Object -First 1)) { throw "Evidence directory is empty: $Path" }
    }
    return $full
}

function Convert-ToBundlePath {
    param([Parameter(Mandatory)] [string]$Path)

    # Accept both a repository/worktree path and an already materialized
    # bundle-relative path. This keeps record composition idempotent.
    $bundleCandidate = if ([IO.Path]::IsPathRooted($Path)) { $null } else { Join-Path $script:evidencePath $Path }
    $full = if ($bundleCandidate -and (Test-Path -LiteralPath $bundleCandidate)) {
        [IO.Path]::GetFullPath($bundleCandidate)
    } else {
        Resolve-RepoEvidencePath $Path
    }
    $evidencePrefix = $script:evidencePath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($full -eq $script:evidencePath) { return "." }
    if ($full.StartsWith($evidencePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        return [IO.Path]::GetRelativePath($script:evidencePath, $full).Replace('\', '/')
    }

    # Records in a timestamped run must never resolve through the mutable
    # worktree or artifacts/.../current. Materialize every external dependency
    # under inputs/ and record only bundle-relative paths.
    $repoRelative = [IO.Path]::GetRelativePath($root, $full).Replace('\', '/')
    $bundleRelative = "inputs/$repoRelative"
    $destination = Join-Path $script:evidencePath $bundleRelative
    if (Test-Path -LiteralPath $full -PathType Container) {
        foreach ($sourceFile in Get-ChildItem -LiteralPath $full -Recurse -File | Sort-Object FullName) {
            $childRelative = [IO.Path]::GetRelativePath($full, $sourceFile.FullName)
            $childDestination = Join-Path $destination $childRelative
            New-Item -ItemType Directory -Force (Split-Path -Parent $childDestination) | Out-Null
            if (Test-Path -LiteralPath $childDestination -PathType Leaf) {
                if ((Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash -ne
                    (Get-FileHash -LiteralPath $childDestination -Algorithm SHA256).Hash) {
                    throw "Conflicting materialized bundle input: $bundleRelative/$($childRelative.Replace('\','/'))"
                }
            } else {
                Copy-Item -LiteralPath $sourceFile.FullName -Destination $childDestination
            }
        }
    } else {
        New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -ne
                (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash) {
                throw "Conflicting materialized bundle input: $bundleRelative"
            }
        } else {
            Copy-Item -LiteralPath $full -Destination $destination
        }
    }
    return $bundleRelative
}

function Assert-SuccessfulCommand {
    param([Parameter(Mandatory)] [string]$Id)
    $matches = @($script:commands | Where-Object id -eq $Id)
    if ($matches.Count -ne 1) { throw "Expected exactly one completed command record for '$Id', found $($matches.Count)." }
    if ([int]$matches[0].exit_code -ne 0) { throw "Command '$Id' did not pass." }
    $logPath = Join-Path $script:evidencePath "logs/$Id.log"
    Resolve-RepoEvidencePath $logPath | Out-Null
    return Convert-ToBundlePath $logPath
}

function Assert-RuntimeEvidence {
    param([Parameter(Mandatory)] [string]$FixtureId, [Parameter(Mandatory)] [string]$Runtime, [Parameter(Mandatory)] [string]$Folder)
    $path = Join-Path $script:evidencePath "$Folder/$FixtureId.json"
    Resolve-RepoEvidencePath $path | Out-Null
    $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -Depth 100
    if ($record.schema_version -ne 1 -or $record.fixture_id -ne $FixtureId -or $record.runtime -ne $Runtime -or
        $record.candidate_id -ne $script:candidate.candidate_id -or $record.candidate_revision -ne $script:candidate.revision -or
        $record.manifest_sha256 -ne $script:manifestHash -or $record.status -ne "passed") {
        throw "Runtime evidence is stale, failed, or has the wrong identity: $Runtime/$FixtureId"
    }
    return Convert-ToBundlePath $path
}

function Assert-NonParityFixtureEvidence {
    param(
        [Parameter(Mandatory)] [string]$FixtureId,
        [Parameter(Mandatory)] [ValidateSet("self_test", "browser_suite")] [string]$SourceKind,
        [Parameter(Mandatory)] [string]$SourceId
    )
    $path = Join-Path $script:evidencePath "fixtures/$FixtureId.json"
    Resolve-RepoEvidencePath $path | Out-Null
    $messages = @()
    if (-not (Test-Json -LiteralPath $path -SchemaFile (Join-Path $script:root "contracts/solid-feature-candidate/fixture-evidence.schema.json") -ErrorAction SilentlyContinue -ErrorVariable +messages)) {
        throw "Non-parity fixture evidence failed schema validation: $FixtureId ($($messages -join '; '))"
    }
    $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -Depth 100
    $fixtureRef = @($script:candidate.fixtures | Where-Object id -eq $FixtureId)
    if ($fixtureRef.Count -ne 1 -or $fixtureRef[0].parity_required) { throw "Fixture '$FixtureId' is not one non-parity manifest fixture." }
    $descriptorPath = Resolve-RepoEvidencePath $fixtureRef[0].path
    $descriptor = Get-Content -LiteralPath $descriptorPath -Raw | ConvertFrom-Json -Depth 100
    $descriptorHash = (Get-FileHash -LiteralPath $descriptorPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($record.candidate_id -ne $script:candidate.candidate_id -or $record.candidate_revision -ne $script:candidate.revision -or
        $record.manifest_sha256 -ne $script:manifestHash -or $record.fixture_id -ne $FixtureId -or
        $record.descriptor_sha256 -ne $descriptorHash -or $record.status -ne "passed" -or
        $record.source_kind -ne $SourceKind -or $record.source_id -ne $SourceId) {
        throw "Non-parity fixture evidence is stale or has the wrong source identity: $FixtureId"
    }
    if (($record.input | ConvertTo-Json -Compress -Depth 100) -ne ($descriptor.input | ConvertTo-Json -Compress -Depth 100) -or
        ($record.result | ConvertTo-Json -Compress -Depth 100) -ne ($descriptor.expected | ConvertTo-Json -Compress -Depth 100)) {
        throw "Non-parity fixture evidence does not equal its descriptor input/expected result: $FixtureId"
    }
    switch ($FixtureId) {
        "qualification-incomplete-candidate" {
            if ($record.assertions.candidate_schema_valid -ne $true -or
                $record.assertions.all_present_evidence_passed -ne $true -or
                $record.assertions.only_missing_subject -ne "fixture:extrude-origin-blind-rectangle" -or
                [int]$record.assertions.actual_subject_count -ne ([int]$record.assertions.otherwise_complete_subject_count - 1)) {
                throw "Incomplete-candidate evidence did not omit exactly the declared fixture subject."
            }
        }
        "parity-deliberate-divergence" {
            if ([double]$record.assertions.native_value -ne [double]$descriptor.input.payload.native -or
                [double]$record.assertions.release_wasm_value -ne [double]$descriptor.input.payload.release_wasm -or
                [int]$record.assertions.difference_count -lt 1) {
                throw "Deliberate-divergence evidence did not use the descriptor-declared values."
            }
        }
        "production-runtime-identity" {
            if ($record.assertions.source_spec -ne "tests/solid-feature-runtime-identity.spec.ts" -or
                $record.assertions.served_wasm_sha256 -ne $script:candidate.runtime_lock.wasm_sha256 -or
                $record.assertions.mock_worker -ne $false -or $record.assertions.production_preview -ne $true -or
                [int]$record.assertions.model_worker_count -ne 1 -or [int]$record.assertions.console_errors -ne 0 -or
                [int]$record.assertions.page_errors -ne 0) {
                throw "Production runtime-identity fixture assertions are incomplete."
            }
        }
        "production-preview-interaction" {
            $dirty = @($record.assertions.recompute_dirty_roots)
            $order = @($record.assertions.recompute_evaluation_order)
            if ($record.assertions.source_spec -ne "tests/solid-feature-qualification.spec.ts" -or
                ($record.assertions.viewport | ConvertTo-Json -Compress) -ne '[1440,900]' -or
                [int]$record.assertions.playwright_workers -ne 1 -or [double]$record.assertions.device_scale_factor -ne 1 -or
                [int]$record.assertions.model_worker_count -ne 1 -or $dirty.Count -lt 1 -or
                ($dirty | ConvertTo-Json -Compress) -ne ($order | ConvertTo-Json -Compress) -or
                [double]$record.assertions.stale_preview_final_distance_mm -ne 9) {
                throw "Production preview-interaction fixture assertions are incomplete."
            }
        }
        "extrude-stale-preview" {
            if ($record.assertions.source_spec -ne "tests/solid-feature-qualification.spec.ts" -or
                ($record.assertions.completion_order | ConvertTo-Json -Compress) -ne '["second","first"]' -or
                ($record.assertions.requested_distances_nm | ConvertTo-Json -Compress) -ne '[4000000,9000000]' -or
                ($record.assertions.delivered_distances_nm | ConvertTo-Json -Compress) -ne '[9000000,4000000]' -or
                [int64]$record.assertions.accepted_distance_nm -ne 9000000 -or
                $record.assertions.accepted_document_unchanged_during_preview -ne $true -or
                ($record.assertions.lifecycle_steps_completed | ConvertTo-Json -Compress) -ne '["preview","cancel","commit","edit","recompute"]' -or
                $record.assertions.preview_completed -ne $true -or $record.assertions.cancel_completed -ne $true -or
                $record.assertions.commit_completed -ne $true -or $record.assertions.edit_completed -ne $true -or
                $record.assertions.recompute_completed -ne $true -or [int]$record.assertions.model_worker_count -ne 1) {
                throw "Stale-preview evidence did not exercise the exact reversed worker lifecycle."
            }
        }
        "extrude-create-edit-equivalence" {
            if ($record.assertions.source_spec -ne "tests/solid-feature-qualification.spec.ts" -or
                ($record.assertions.flows_exercised | ConvertTo-Json -Compress) -ne '["tool_first","selection_first","timeline_edit","timeline_edit_selected_region_replacement","timeline_edit_cross_sketch_replacement_rejected"]' -or
                [int64]$record.assertions.distance_nm -ne 4000000 -or
                $record.assertions.canonical_definitions_equal -ne $true -or $record.assertions.camera_invariant_handle -ne $true -or
                $record.assertions.tool_first_without_profile_selection -ne $true -or
                $record.assertions.selection_first_profile_selected -ne $true -or
                $record.assertions.timeline_edit_retained_feature -ne $true -or
                $record.assertions.selected_region_replacement_persisted -ne $true -or
                $record.assertions.selected_region_replacement_source_sketch_retained -ne $true -or
                $record.assertions.selected_region_replacement_cancel_restored -ne $true -or
                $record.assertions.selected_region_replacement_feature_id_retained -ne $true -or
                $record.assertions.selected_region_replacement_body_id_retained -ne $true -or
                $record.assertions.selected_region_replacement_recompute_correct -ne $true -or
                $record.assertions.selected_region_replacement_reload_persisted -ne $true -or
                $record.result.result.cross_sketch_replacement_rejected -ne $true -or
                $record.result.result.cross_sketch_accepted_state_unchanged -ne $true -or
                $record.result.result.cross_sketch_references_unchanged -ne $true -or
                $record.result.result.cross_sketch_feature_and_body_ids_retained -ne $true -or
                $record.result.result.cross_sketch_geometry_unchanged -ne $true -or
                $record.result.result.cross_sketch_feature_count_unchanged -ne $true -or
                $record.result.result.cross_sketch_no_invalid_preview_or_commit -ne $true -or
                $record.result.result.cross_sketch_explicit_error -ne $true -or
                $record.result.result.cross_sketch_zero_preview_or_commit_dispatch -ne $true -or
                $record.result.result.cross_sketch_edit_blocked -ne $true -or
                $record.result.result.cross_sketch_error_reason_present -ne $true -or
                $record.assertions.cross_sketch_replacement_rejected -ne $true -or
                $record.assertions.cross_sketch_accepted_document_hash_unchanged -ne $true -or
                $record.assertions.cross_sketch_feature_id_retained -ne $true -or
                $record.assertions.cross_sketch_body_id_retained -ne $true -or
                $record.assertions.cross_sketch_source_sketch_reference_unchanged -ne $true -or
                $record.assertions.cross_sketch_support_reference_unchanged -ne $true -or
                $record.assertions.cross_sketch_region_reference_unchanged -ne $true -or
                $record.assertions.cross_sketch_geometry_bounds_unchanged -ne $true -or
                $record.assertions.cross_sketch_feature_count_unchanged -ne $true -or
                $record.assertions.cross_sketch_no_invalid_preview -ne $true -or
                $record.assertions.cross_sketch_no_invalid_commit -ne $true -or
                $record.assertions.cross_sketch_explicit_edit_error -ne $true -or
                $record.assertions.cross_sketch_edit_blocked -ne $true -or
                [string]$record.assertions.cross_sketch_error_reason -ne "The selected replacement profile must belong to this Extrude's source sketch and resolved support." -or
                [int]$record.assertions.cross_sketch_preview_dispatch_count -ne 0 -or
                [int]$record.assertions.cross_sketch_commit_dispatch_count -ne 0 -or
                $record.assertions.cross_sketch_recompute_unchanged -ne $true -or
                $record.assertions.cross_sketch_reload_unchanged -ne $true -or
                ($record.assertions.lifecycle_steps_completed | ConvertTo-Json -Compress) -ne '["preview","cancel","commit","edit","recompute","reload"]' -or
                $record.assertions.preview_completed -ne $true -or $record.assertions.cancel_completed -ne $true -or
                $record.assertions.commit_completed -ne $true -or $record.assertions.edit_completed -ne $true -or
                $record.assertions.recompute_completed -ne $true -or $record.assertions.reload_completed -ne $true -or
                ($record.assertions.model_worker_counts | ConvertTo-Json -Compress) -ne '[1,1,1]' -or
                [int]$record.assertions.console_errors -ne 0 -or [int]$record.assertions.page_errors -ne 0) {
                throw "Create/edit-equivalence evidence did not exercise every declared UI flow and lifecycle step."
            }
        }
        "production-planar-face-lifecycle" {
            $repairKinds = @($record.assertions.repair_transaction_changes | ForEach-Object kind)
            $workerUrls = @($record.assertions.generated_worker_urls)
            if ($record.assertions.support_body -ne [string]$descriptor.input.payload.support_body -or
                ($record.assertions.directions_executed | ConvertTo-Json -Compress) -ne ($descriptor.input.payload.directions | ConvertTo-Json -Compress) -or
                ($record.assertions.lifecycle_executed | ConvertTo-Json -Compress) -ne ($descriptor.lifecycle_steps | ConvertTo-Json -Compress) -or
                @($record.assertions.upstream_evaluation_order).Count -lt 3 -or
                [string]::IsNullOrWhiteSpace([string]$record.assertions.topology_reference_before) -or
                [string]::IsNullOrWhiteSpace([string]$record.assertions.topology_reference_after) -or
                $record.assertions.topology_reference_before -eq $record.assertions.topology_reference_after -or
                ($repairKinds | ConvertTo-Json -Compress) -ne '["rebind_topology","accept_feature_result"]' -or
                $record.assertions.cancelled_repair_preview_basis.phase -ne "ready" -or
                $record.assertions.committed_repair_preview_basis.phase -ne "ready" -or
                $record.assertions.cancelled_repair_preview_basis.selected -ne $record.assertions.committed_repair_preview_basis.selected -or
                $record.assertions.cancelled_repair_preview_basis.baseDocumentHash -ne $record.assertions.committed_repair_preview_basis.baseDocumentHash -or
                $workerUrls.Count -ne 2 -or
                @($workerUrls | Where-Object { $_ -notmatch '/assets/(model|persistence)\.worker-[A-Za-z0-9_-]+\.js$' }).Count -ne 0) {
                throw "Production planar-face lifecycle assertions are incomplete or internally inconsistent."
            }
        }
        "production-single-target-cut-lifecycle" {
            if ($record.assertions.source_spec -ne "tests/solid-feature-cut-qualification.spec.ts" -or
                $record.assertions.explicit_target_selected -ne $true -or
                $record.assertions.preview_source -ne "worker-render-packet" -or
                $record.assertions.result_mode -ne "cut" -or
                $record.assertions.target_body_retained -ne $true -or
                [int]$record.assertions.affected_body_count -ne 1 -or
                [int]$record.assertions.created_body_count -ne 0 -or
                $record.assertions.missing_target_zero_dispatch -ne $true -or
                $record.assertions.accepted_state_unchanged_on_failure -ne $true -or
                [int]$record.assertions.console_errors -ne 0 -or [int]$record.assertions.page_errors -ne 0) {
                throw "Production single-target Cut fixture assertions are incomplete."
            }
        }
        default { throw "No non-parity assertion contract exists for '$FixtureId'." }
    }
    return Convert-ToBundlePath $path
}

function Add-Record {
    param(
        [Parameter(Mandatory)] [ValidateSet("story", "fixture", "test", "artifact")] [string]$Kind,
        [Parameter(Mandatory)] [string]$Id,
        [Parameter(Mandatory)] [string[]]$EvidencePaths,
        [hashtable]$Details = @{}
    )
    $verified = @($EvidencePaths | ForEach-Object { Convert-ToBundlePath $_ } | Sort-Object -Unique)
    if ($verified.Count -eq 0) { throw "Qualification record $Kind/$Id has no evidence." }
    $script:records.Add([ordered]@{
        schema_version = 1
        candidate_id = $script:candidate.candidate_id
        candidate_revision = $script:candidate.revision
        manifest_sha256 = $script:manifestHash
        subject_kind = $Kind
        subject_id = $Id
        status = "passed"
        recorded_at = $script:recordedAt
        evidence_paths = $verified
        details = $Details
    })
}

$manifestPath = Resolve-RepoEvidencePath $Manifest
$evidencePath = Resolve-RepoEvidencePath $EvidenceRoot
$candidate = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -Depth 100
$manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
$recordedAt = [DateTimeOffset]::UtcNow.ToString('o')
$commandsPath = Resolve-RepoEvidencePath (Join-Path $evidencePath "commands.json")
$commands = @(Get-Content -LiteralPath $commandsPath -Raw | ConvertFrom-Json -Depth 100)
$records = [Collections.Generic.List[object]]::new()

# Preserve the exact manifest and schemas used to interpret this run. These are
# not merely convenient copies: the isolated-bundle validator verifies the
# manifest digest without consulting the checkout.
Convert-ToBundlePath $manifestPath | Out-Null
foreach ($contract in @(
    "contracts/solid-feature-candidate/candidate.schema.json",
    "contracts/solid-feature-candidate/evidence.schema.json",
    "contracts/solid-feature-candidate/fixture.schema.json",
    "contracts/solid-feature-candidate/fixture-evidence.schema.json",
    "contracts/solid-feature-candidate/qualification-record.schema.json",
    "contracts/solid-feature-candidate/source-snapshot.schema.json",
    "contracts/solid-feature-candidate/legacy-solid-feature-matrix.v1.json",
    "contracts/solid-feature-candidate/performance-budgets.v1.json",
    "contracts/solid-feature-candidate/qualification-environment.v1.json"
)) { Convert-ToBundlePath $contract | Out-Null }
$legacyMatrixSource = Get-Content -LiteralPath (Join-Path $root "contracts/solid-feature-candidate/legacy-solid-feature-matrix.v1.json") -Raw | ConvertFrom-Json -Depth 20
foreach ($legacyEvidencePath in @($legacyMatrixSource.evidence)) {
    Convert-ToBundlePath ([string]$legacyEvidencePath) | Out-Null
}

# A record may only be emitted after every command used as its proof has a
# successful command ledger entry and an existing log file.
$commandEvidence = @{}
$requiredCommandEvidenceIds = @(
    "candidate-contracts", "native-workspace", "native-planar-face-contracts", "wasm-crawler-part-runtime", "app-unit",
    "worker-spike", "parity-self-tests", "non-parity-self-tests", "native-evidence", "wasm-evidence",
    "native-wasm-parity", "production-browser"
)
if ($candidate.candidate_id -eq "solid-feature-sprint-5") {
    $requiredCommandEvidenceIds += @("native-single-target-cut-contracts", "wasm-single-target-cut-adapter")
}
foreach ($id in $requiredCommandEvidenceIds) {
    $commandEvidence[$id] = Assert-SuccessfulCommand $id
}

$parityJsonPath = Resolve-RepoEvidencePath (Join-Path $evidencePath "parity/parity.json")
$parity = Get-Content -LiteralPath $parityJsonPath -Raw | ConvertFrom-Json -Depth 100
$parityFixtureIds = @($candidate.fixtures | Where-Object parity_required | ForEach-Object id)
if ($parity.status -ne "passed" -or $parity.candidate_id -ne $candidate.candidate_id -or
    $parity.candidate_revision -ne $candidate.revision -or $parity.manifest_sha256 -ne $manifestHash -or
    [int]$parity.compared_fixture_count -ne $parityFixtureIds.Count -or @($parity.results | Where-Object status -ne "passed").Count -ne 0) {
    throw "The native/release-WASM parity summary is stale, incomplete, or failed."
}

$browserJunitPath = Resolve-RepoEvidencePath (Join-Path $evidencePath "browser/junit.xml")
[xml]$browserJunit = Get-Content -LiteralPath $browserJunitPath -Raw
$browserRoot = $browserJunit.testsuites
if ($null -eq $browserRoot -or [int]$browserRoot.tests -lt 1 -or [int]$browserRoot.failures -ne 0 -or [int]$browserRoot.errors -ne 0 -or [int]$browserRoot.skipped -ne 0) {
    throw "The production browser JUnit report is absent, empty, or failed."
}
$browserManifestTests = @{}
foreach ($test in $candidate.tests | Where-Object { $_.kind -in @("browser", "performance") -and $_.command -match "playwright\s+test" }) {
    $specs = @([regex]::Matches([string]$test.command, 'tests[/\\][^\s"'']+\.spec\.ts') | ForEach-Object { $_.Value.Replace('\', '/') } | Sort-Object -Unique)
    if ($specs.Count -ne 1) { throw "Manifest browser test '$($test.id)' must name exactly one Playwright spec." }
    $browserManifestTests[$test.id] = $specs[0]
}
$browserSuites = @($browserRoot.testsuite)
$browserSuiteIds = @($browserSuites | ForEach-Object { [string]$_.name })
$duplicateBrowserSuites = @($browserSuiteIds | Group-Object | Where-Object Count -ne 1)
$missingBrowserSuites = @($browserManifestTests.Keys | Where-Object { $_ -notin $browserSuiteIds } | Sort-Object)
$unexpectedBrowserSuites = @($browserSuiteIds | Where-Object { -not $browserManifestTests.ContainsKey($_) } | Sort-Object)
if ($browserSuites.Count -ne $browserManifestTests.Count -or $duplicateBrowserSuites.Count -gt 0 -or
    $missingBrowserSuites.Count -gt 0 -or $unexpectedBrowserSuites.Count -gt 0) {
    throw "Browser JUnit manifest coverage differs (missing: $($missingBrowserSuites -join ', '); unexpected: $($unexpectedBrowserSuites -join ', '))."
}
$browserCaseCount = (@($browserSuites | ForEach-Object { @($_.testcase).Count }) | Measure-Object -Sum).Sum
if ([int]$browserRoot.tests -ne $browserCaseCount) { throw "Browser JUnit root test count does not match its suites." }
foreach ($suite in $browserSuites) {
    $id = [string]$suite.name
    if ([string]$suite.source_spec -ne $browserManifestTests[$id] -or [int]$suite.tests -lt 1 -or
        [int]$suite.failures -ne 0 -or [int]$suite.errors -ne 0 -or [int]$suite.skipped -ne 0 -or
        @($suite.testcase).Count -ne [int]$suite.tests) {
        throw "Browser JUnit suite '$id' is stale, incomplete, or failed."
    }
}

$performanceResultPath = Join-Path $evidencePath "performance/results.json"
if (@($candidate.tests | Where-Object kind -eq "performance").Count -gt 0) {
    $performanceResultPath = Resolve-RepoEvidencePath $performanceResultPath
    $performance = Get-Content -LiteralPath $performanceResultPath -Raw | ConvertFrom-Json -Depth 100
    $budgetPath = Join-Path $root "contracts/solid-feature-candidate/performance-budgets.v1.json"
    $budgetProfile = Get-Content -LiteralPath $budgetPath -Raw | ConvertFrom-Json -Depth 100
    if ($performance.schema_version -ne 1 -or $performance.status -ne "passed" -or
        $performance.profile_id -ne $budgetProfile.profile_id -or
        $performance.runtime_build_id -ne $candidate.runtime_lock.build_id -or
        $performance.runtime_wasm_sha256 -ne $candidate.runtime_lock.wasm_sha256) {
        throw "Performance evidence is stale, failed, or has the wrong candidate runtime identity."
    }
    $expectedWorkloads = @($candidate.performance_workload_ids | ForEach-Object { [string]$_ } | Sort-Object)
    $lockedWorkloads = @($budgetProfile.workloads | Where-Object { [string]$_.id -in $expectedWorkloads })
    $actualWorkloads = @($performance.workloads | ForEach-Object workload_id | Sort-Object)
    if ($lockedWorkloads.Count -ne $expectedWorkloads.Count -or
        @($expectedWorkloads | Group-Object | Where-Object Count -ne 1).Count -gt 0 -or
        ($expectedWorkloads -join "`n") -ne ($actualWorkloads -join "`n") -or
        @($actualWorkloads | Group-Object | Where-Object Count -ne 1).Count -gt 0) {
        throw "Performance evidence workload set differs from the candidate's locked budget subset."
    }
    foreach ($requiredWorkload in @($candidate.performance_workload_ids)) {
        if ($requiredWorkload -notin $expectedWorkloads -or $requiredWorkload -notin $actualWorkloads) {
            throw "Candidate-required performance workload '$requiredWorkload' is absent from its locked budget or result."
        }
    }
    foreach ($budget in $lockedWorkloads) {
        $observed = @($performance.workloads | Where-Object workload_id -eq $budget.id)
        if ($observed.Count -ne 1 -or $observed[0].status -ne "passed" -or @($observed[0].violations).Count -ne 0 -or
            [int]$observed[0].samples.warm_up -ne [int]$budgetProfile.warm_up_samples -or
            [int]$observed[0].samples.measured -ne [int]$budgetProfile.measured_samples -or
            [int]$observed[0].samples.preview_edit_cancel_cycles -ne [int]$budget.preview_edit_cancel_cycles -or
            ($observed[0].budgets | ConvertTo-Json -Compress) -ne ($budget | ConvertTo-Json -Compress) -or
            [double]$observed[0].observed.preview_p50_ms -gt [double]$budget.preview_p50_ms_max -or
            [double]$observed[0].observed.preview_p95_ms -gt [double]$budget.preview_p95_ms_max -or
            [double]$observed[0].observed.recompute_p50_ms -gt [double]$budget.recompute_p50_ms_max -or
            [double]$observed[0].observed.recompute_p95_ms -gt [double]$budget.recompute_p95_ms_max -or
            [double]$observed[0].observed.cancellation_latency_ms_max -gt [double]$budget.cancellation_latency_ms_max -or
            [double]$observed[0].observed.main_thread_long_task_ms_max -gt [double]$budget.main_thread_long_task_ms_max -or
            [double]$observed[0].observed.memory_growth_bytes -gt [double]$budget.memory_growth_bytes_max) {
            throw "Performance workload '$($budget.id)' is incomplete, changed, or over budget."
        }
    }
}

$legacyTestEvidence = @($commandEvidence["native-workspace"], (Join-Path $evidencePath "migration/legacy-matrix.json")) + @($legacyMatrixSource.evidence)
$testEvidence = @{
    "candidate-manifest-validation" = @($commandEvidence["candidate-contracts"])
    "feature-definition-v2-contracts" = @($commandEvidence["native-workspace"])
    "native-profile-transport" = @($commandEvidence["native-workspace"])
    "wasm-profile-transport" = @($commandEvidence["wasm-crawler-part-runtime"])
    "region-contracts" = @($commandEvidence["native-workspace"])
    "profile-handoff-regression" = @($commandEvidence["production-browser"], $browserJunitPath)
    "native-extrude-contracts" = @($commandEvidence["native-workspace"])
    "wasm-extrude-contracts" = @($commandEvidence["worker-spike"])
    "extrude-command-state" = @($commandEvidence["app-unit"])
    "legacy-solid-operation-matrix" = $legacyTestEvidence
    "native-wasm-parity" = @($commandEvidence["native-wasm-parity"], $parityJsonPath, (Join-Path $evidencePath "parity/parity.junit.xml"))
    "parity-deliberate-divergence" = @($commandEvidence["parity-self-tests"])
    "production-runtime-identity" = @($commandEvidence["production-browser"], $browserJunitPath)
    "production-extrude-lifecycle" = @($commandEvidence["production-browser"], $browserJunitPath, (Join-Path $evidencePath "browser/screenshots"))
    "production-preview-performance" = @($commandEvidence["production-browser"], $browserJunitPath, (Join-Path $evidencePath "performance/results.json"))
    # Sprint 2 has distinct test identities and records. The same full-gate
    # command ledger is reused only as contemporaneous command evidence from
    # the selected Sprint 2 manifest run; no Sprint 1 record is reused.
    "direction-contracts" = @($commandEvidence["native-workspace"])
    "native-direction-extrude" = @($commandEvidence["native-workspace"])
    "wasm-direction-extrude" = @($commandEvidence["worker-spike"])
    "direction-command-state" = @($commandEvidence["app-unit"])
    "direction-native-wasm-parity" = @($commandEvidence["native-wasm-parity"], $parityJsonPath, (Join-Path $evidencePath "parity/parity.junit.xml"))
    "production-direction-lifecycle" = @($commandEvidence["production-browser"], $browserJunitPath, (Join-Path $evidencePath "browser/screenshots"))
    "direction-performance-regression" = @($commandEvidence["production-browser"], $browserJunitPath, (Join-Path $evidencePath "performance/results.json"))
    "planar-face-document-authority-contracts" = @($commandEvidence["native-planar-face-contracts"])
    "native-planar-face-extrude" = @($commandEvidence["native-evidence"], (Join-Path $evidencePath "runtime/native"))
    "wasm-planar-face-extrude" = @($commandEvidence["wasm-evidence"], (Join-Path $evidencePath "runtime/release-wasm"))
    "single-target-cut-contracts" = @($commandEvidence["native-single-target-cut-contracts"])
    "native-single-target-cut" = @($commandEvidence["native-evidence"], (Join-Path $evidencePath "runtime/native"))
    "wasm-single-target-cut" = @($commandEvidence["wasm-evidence"], (Join-Path $evidencePath "runtime/release-wasm"))
    "single-target-cut-wasm-adapter-regression" = @($commandEvidence["wasm-single-target-cut-adapter"])
    "single-target-cut-command-state" = @($commandEvidence["app-unit"])
    "single-target-cut-native-wasm-parity" = @($commandEvidence["native-wasm-parity"], $parityJsonPath, (Join-Path $evidencePath "parity/parity.junit.xml"))
    "production-single-target-cut-lifecycle" = @($commandEvidence["production-browser"], $browserJunitPath, (Join-Path $evidencePath "browser/screenshots"))
    "single-target-cut-performance-regression" = @($commandEvidence["production-browser"], $browserJunitPath, (Join-Path $evidencePath "performance/results.json"))
}
$testCommandIds = @{
    "planar-face-document-authority-contracts" = @("native-planar-face-contracts")
    "native-planar-face-extrude" = @("native-evidence")
    "wasm-planar-face-extrude" = @("wasm-evidence")
    "single-target-cut-contracts" = @("native-single-target-cut-contracts")
    "native-single-target-cut" = @("native-evidence")
    "wasm-single-target-cut" = @("wasm-evidence")
    "single-target-cut-wasm-adapter-regression" = @("wasm-single-target-cut-adapter")
}

foreach ($test in $candidate.tests | Where-Object { $_.id -ne "candidate-evidence-completeness" }) {
    if (-not $testEvidence.ContainsKey($test.id)) {
        # Candidate-local test IDs may reuse one of the complete gate's exact
        # supersets. Resolve only an allowlisted command shape; an unfamiliar
        # kind or command still fails closed instead of receiving generic proof.
        $command = [string]$test.command
        $resolved = switch ([string]$test.kind) {
            "native" {
                if ($command -match '^cargo test --workspace --locked(?:\s+[A-Za-z0-9_.:-]+)?$') { @($commandEvidence["native-workspace"]) }
            }
            "wasm" {
                if ($command -eq 'node --test web/worker-spike/worker-spike.test.mjs') { @($commandEvidence["worker-spike"]) }
            }
            "unit" {
                if ($command -eq 'pnpm --dir web/crawler-app test:unit') { @($commandEvidence["app-unit"]) }
            }
            "parity" {
                if ($command -match '^node scripts/compare-solid-feature-parity\.mjs --manifest contracts/solid-feature-candidate/sprint-[1-9][0-9]*\.json$') {
                    @($commandEvidence["native-wasm-parity"], $parityJsonPath, (Join-Path $evidencePath "parity/parity.junit.xml"))
                }
            }
            "browser" {
                if ($command -match '^pnpm --dir web/crawler-app exec playwright test tests[/\\][A-Za-z0-9_.-]+\.spec\.ts --config playwright\.solid-feature-qualification\.config\.ts$') {
                    @($commandEvidence["production-browser"], $browserJunitPath, (Join-Path $evidencePath "browser/screenshots"))
                }
            }
            "performance" {
                if ($command -in @(
                    'pnpm --dir web/crawler-app exec playwright test tests/solid-feature-performance.spec.ts --config playwright.solid-feature-qualification.config.ts',
                    'pnpm --dir web/crawler-app exec playwright test tests/solid-feature-cut-performance.spec.ts --config playwright.solid-feature-qualification.config.ts'
                )) {
                    @($commandEvidence["production-browser"], $browserJunitPath, $performanceResultPath)
                }
            }
        }
        if (@($resolved).Count -eq 0) { throw "No fail-closed evidence mapping exists for required test '$($test.id)' with kind '$($test.kind)' and command '$command'." }
        $testEvidence[$test.id] = @($resolved)
    }
    $details = @{ command = $test.command }
    if ($testCommandIds.ContainsKey($test.id)) {
        $ledgerIds = @($testCommandIds[$test.id])
        $details.command_ledger_ids = $ledgerIds
        $details.command_invocation_sha256 = @($ledgerIds | ForEach-Object {
            $ledger = @($commands | Where-Object id -eq $_)
            if ($ledger.Count -ne 1 -or @($ledger[0].invocations).Count -ne 1) {
                throw "Test '$($test.id)' does not resolve to one exact command invocation for ledger entry '$_'."
            }
            if ([string]$ledger[0].invocations[0].rerun -cne [string]$test.command) {
                throw "Test '$($test.id)' command does not match its executing ledger invocation '$_'."
            }
            [string]$ledger[0].invocations[0].invocation_sha256
        })
    }
    if ($browserManifestTests.ContainsKey($test.id)) {
        $details.browser_manifest_test_id = $test.id
        $details.source_spec = $browserManifestTests[$test.id]
    }
    Add-Record "test" $test.id $testEvidence[$test.id] $details
}

foreach ($fixture in $candidate.fixtures) {
    $paths = [Collections.Generic.List[string]]::new()
    $paths.Add($fixture.path)
    if ($fixture.parity_required) {
        $paths.Add((Assert-RuntimeEvidence $fixture.id "native" "runtime/native"))
        $paths.Add((Assert-RuntimeEvidence $fixture.id "release_wasm" "runtime/release-wasm"))
        $paths.Add($parityJsonPath)
    } else {
        switch ($fixture.id) {
            "qualification-incomplete-candidate" { $paths.Add((Assert-NonParityFixtureEvidence $fixture.id "self_test" "non-parity-self-tests")); $paths.Add($commandEvidence["non-parity-self-tests"]) }
            "parity-deliberate-divergence" { $paths.Add((Assert-NonParityFixtureEvidence $fixture.id "self_test" "non-parity-self-tests")); $paths.Add($commandEvidence["non-parity-self-tests"]) }
            "production-runtime-identity" {
                $paths.Add((Assert-NonParityFixtureEvidence $fixture.id "browser_suite" "production-runtime-identity"));
                $paths.Add($browserJunitPath); $paths.Add($commandEvidence["production-browser"])
            }
            "production-preview-interaction" {
                $paths.Add((Assert-NonParityFixtureEvidence $fixture.id "browser_suite" "production-extrude-lifecycle"));
                $paths.Add($browserJunitPath); $paths.Add((Join-Path $evidencePath "browser/screenshots")); $paths.Add($commandEvidence["production-browser"])
            }
            "extrude-stale-preview" {
                $paths.Add((Assert-NonParityFixtureEvidence $fixture.id "browser_suite" "production-extrude-lifecycle"));
                $paths.Add($browserJunitPath); $paths.Add((Join-Path $evidencePath "browser/screenshots")); $paths.Add($commandEvidence["production-browser"])
            }
            "extrude-create-edit-equivalence" {
                $paths.Add((Assert-NonParityFixtureEvidence $fixture.id "browser_suite" "production-extrude-lifecycle"));
                $paths.Add($browserJunitPath); $paths.Add((Join-Path $evidencePath "browser/screenshots")); $paths.Add($commandEvidence["production-browser"])
            }
            "production-planar-face-lifecycle" {
                $paths.Add((Assert-NonParityFixtureEvidence $fixture.id "browser_suite" "web/crawler-app/tests/solid-feature-planar-face-qualification.spec.ts"));
                $paths.Add($browserJunitPath); $paths.Add((Join-Path $evidencePath "browser/screenshots"));
                $paths.Add($performanceResultPath); $paths.Add($commandEvidence["production-browser"])
            }
            "production-single-target-cut-lifecycle" {
                $paths.Add((Assert-NonParityFixtureEvidence $fixture.id "browser_suite" "web/crawler-app/tests/solid-feature-cut-qualification.spec.ts"));
                $paths.Add($browserJunitPath); $paths.Add((Join-Path $evidencePath "browser/screenshots"));
                $paths.Add($performanceResultPath); $paths.Add($commandEvidence["production-browser"])
            }
            default { throw "No evidence mapping exists for non-parity fixture '$($fixture.id)'." }
        }
    }
    $details = @{ parity_required = [bool]$fixture.parity_required }
    if (-not $fixture.parity_required) {
        $details.fixture_evidence_path = Convert-ToBundlePath (Join-Path $evidencePath "fixtures/$($fixture.id).json")
        if ($fixture.id -eq "production-runtime-identity") { $details.browser_manifest_test_id = "production-runtime-identity"; $details.source_spec = $browserManifestTests["production-runtime-identity"] }
        if ($fixture.id -eq "production-preview-interaction") { $details.browser_manifest_test_id = "production-extrude-lifecycle"; $details.source_spec = $browserManifestTests["production-extrude-lifecycle"] }
        if ($fixture.id -in @("extrude-stale-preview", "extrude-create-edit-equivalence")) { $details.browser_manifest_test_id = "production-extrude-lifecycle"; $details.source_spec = $browserManifestTests["production-extrude-lifecycle"] }
        if ($fixture.id -eq "production-planar-face-lifecycle") { $details.browser_manifest_test_id = "production-planar-face-lifecycle"; $details.source_spec = $browserManifestTests["production-planar-face-lifecycle"] }
        if ($fixture.id -eq "production-single-target-cut-lifecycle") { $details.browser_manifest_test_id = "production-single-target-cut-lifecycle"; $details.source_spec = $browserManifestTests["production-single-target-cut-lifecycle"] }
    }
    Add-Record "fixture" $fixture.id @($paths) $details
}

$artifactEvidence = @{}
foreach ($artifact in $candidate.artifacts | Where-Object required) {
    $full = Resolve-RepoEvidencePath $artifact.path
    if (Test-Path -LiteralPath $full -PathType Container) { Resolve-RepoEvidencePath $full -NonEmptyDirectory | Out-Null }
    if ($artifact.id -eq "legacy-matrix-results") {
        $sourceMatrix = Resolve-RepoEvidencePath "contracts/solid-feature-candidate/legacy-solid-feature-matrix.v1.json"
        if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $sourceMatrix -Algorithm SHA256).Hash) {
            throw "The migration result is not a byte-identical copy of the checked legacy matrix."
        }
    }
    if ($artifact.lock_required) {
        $actual = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $artifact.expected_sha256) { throw "Locked artifact '$($artifact.id)' has digest '$actual', expected '$($artifact.expected_sha256)'." }
    }
    $artifactEvidence[$artifact.id] = Convert-ToBundlePath $full
    Add-Record "artifact" $artifact.id @($full) @{ bundle_path = $artifactEvidence[$artifact.id]; locked = [bool]$artifact.lock_required }
}

foreach ($story in $candidate.stories | Where-Object evidence_policy -eq "required") {
    $paths = [Collections.Generic.List[string]]::new()
    foreach ($testId in $story.test_ids | Where-Object { $_ -ne "candidate-evidence-completeness" }) {
        if (-not $testEvidence.ContainsKey($testId)) { throw "Story '$($story.id)' refers to an unmapped test '$testId'." }
        $testEvidence[$testId] | ForEach-Object { $paths.Add($_) }
    }
    foreach ($artifactId in $story.artifact_ids) { $paths.Add($artifactEvidence[$artifactId]) }
    Add-Record "story" $story.id @($paths) @{ capability = $story.capability }
}

$recordsPath = Join-Path $evidencePath "records"
$pendingPath = Join-Path $evidencePath ("records.pending-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $pendingPath | Out-Null
try {
    foreach ($record in $records) {
        $name = "$($record.subject_kind).$($record.subject_id).json"
        $path = Join-Path $pendingPath $name
        $record | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $path -Encoding utf8NoBOM
        $messages = @()
        if (-not (Test-Json -LiteralPath $path -SchemaFile (Join-Path $root "contracts/solid-feature-candidate/qualification-record.schema.json") -ErrorAction SilentlyContinue -ErrorVariable +messages)) {
            throw "Generated qualification record failed schema validation: $name ($($messages -join '; '))"
        }
    }
    if (Test-Path -LiteralPath $recordsPath) { Remove-Item -LiteralPath $recordsPath -Recurse -Force }
    Move-Item -LiteralPath $pendingPath -Destination $recordsPath
}
finally {
    if (Test-Path -LiteralPath $pendingPath) { Remove-Item -LiteralPath $pendingPath -Recurse -Force }
}

Write-Host "Wrote $($records.Count) fail-closed qualification records to $recordsPath." -ForegroundColor Green
