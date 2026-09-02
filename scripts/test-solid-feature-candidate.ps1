[CmdletBinding()]
param(
    [string]$Manifest = "contracts/solid-feature-candidate/sprint-1.json",
    [string]$EvidenceRoot,
    [switch]$ArtifactReady,
    [switch]$CompletenessPreflight,
    [switch]$QualificationReady
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Resolve-RepoPath {
    param([Parameter(Mandatory)] [string]$Path, [switch]$MustExist)
    $candidate = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $root $Path }
    $full = [IO.Path]::GetFullPath($candidate)
    $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($full -ne $root -and -not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes the repository: $Path"
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $full)) { throw "Required path is absent: $Path" }
    return $full
}

function Assert-JsonSchema {
    param([Parameter(Mandatory)] [string]$JsonPath, [Parameter(Mandatory)] [string]$SchemaPath)
    $messages = @()
    $valid = Test-Json -LiteralPath $JsonPath -SchemaFile $SchemaPath -ErrorAction SilentlyContinue -ErrorVariable +messages
    if (-not $valid) { throw "Schema validation failed for '$JsonPath': $($messages -join '; ')" }
}

function Assert-UniqueIds {
    param([Parameter(Mandatory)] [object[]]$Items, [Parameter(Mandatory)] [string]$Collection)
    $duplicates = @($Items | Group-Object id | Where-Object Count -gt 1 | ForEach-Object Name)
    if ($duplicates.Count -gt 0) { throw "$Collection contains duplicate IDs: $($duplicates -join ', ')" }
}

$manifestPath = Resolve-RepoPath $Manifest -MustExist
$contractRoot = Join-Path $root "contracts/solid-feature-candidate"
Assert-JsonSchema $manifestPath (Join-Path $contractRoot "candidate.schema.json")
$candidate = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -Depth 100
$fixtureSchema = Get-Content -LiteralPath (Join-Path $contractRoot "fixture.schema.json") -Raw | ConvertFrom-Json -Depth 100
$evidenceSchema = Get-Content -LiteralPath (Join-Path $contractRoot "evidence.schema.json") -Raw | ConvertFrom-Json -Depth 100
$declaredLifecycleSteps = @($fixtureSchema.properties.lifecycle_steps.items.enum | Sort-Object)
$evidenceLifecycleSteps = @($evidenceSchema.properties.executed_lifecycle_steps.items.enum | Sort-Object)
if (($declaredLifecycleSteps -join "`n") -cne ($evidenceLifecycleSteps -join "`n")) {
    throw "Fixture and evidence lifecycle-step enums diverge; declared steps could become unrecordable."
}

Assert-UniqueIds @($candidate.stories) "stories"
Assert-UniqueIds @($candidate.fixtures) "fixtures"
Assert-UniqueIds @($candidate.tests) "tests"
Assert-UniqueIds @($candidate.artifacts) "artifacts"
if (-not $candidate.scope_frozen) { throw "Candidate scope must be frozen." }

$storyIds = @{}; $candidate.stories | ForEach-Object { $storyIds[$_.id] = $true }
$fixtureIds = @{}; $candidate.fixtures | ForEach-Object { $fixtureIds[$_.id] = $true }
$testIds = @{}; $candidate.tests | ForEach-Object { $testIds[$_.id] = $true }
$artifactIds = @{}; $candidate.artifacts | ForEach-Object { $artifactIds[$_.id] = $true }
$parityTestIds = @($candidate.tests | Where-Object kind -eq "parity" | ForEach-Object id)
$fixtureDescriptors = @{}
$successEvidenceSchemas = @($evidenceSchema.properties.result.oneOf | Where-Object { $_.properties.kind.const -eq "success" })
if ($successEvidenceSchemas.Count -ne 1) { throw "Evidence schema must declare exactly one success-result branch." }
$successEvidencePropertyNames = @($successEvidenceSchemas[0].properties.PSObject.Properties.Name)

if ($null -ne $candidate.performance_workload_ids) {
    if (@($candidate.tests | Where-Object kind -eq "performance").Count -eq 0) {
        throw "Candidate declares performance workloads but no performance test."
    }
    $budgetProfile = Get-Content -LiteralPath (Join-Path $contractRoot "performance-budgets.v1.json") -Raw | ConvertFrom-Json -Depth 100
    $budgetIds = @{}; $budgetProfile.workloads | ForEach-Object { $budgetIds[$_.id] = $true }
    foreach ($workloadId in $candidate.performance_workload_ids) {
        if (-not $budgetIds.ContainsKey([string]$workloadId)) { throw "Candidate names unknown locked performance workload '$workloadId'." }
    }
}

foreach ($fixtureRef in $candidate.fixtures) {
    $fixturePath = Resolve-RepoPath $fixtureRef.path -MustExist
    Assert-JsonSchema $fixturePath (Join-Path $contractRoot "fixture.schema.json")
    $fixture = Get-Content -LiteralPath $fixturePath -Raw | ConvertFrom-Json -Depth 100
    $fixtureDescriptors[[string]$fixture.fixture_id] = $fixture
    # Revision 3 added fixture-specific recovery/result assertions to the shared
    # evidence envelope.  Keep that contract exact without retroactively
    # requiring legacy Sprint 1-4 descriptor-only fields in runtime evidence.
    if ($candidate.candidate_id -eq "solid-feature-sprint-5" -and $candidate.revision -ge 3 -and
        $fixtureRef.parity_required -and $fixture.expected.kind -eq "success") {
        $unsupportedResultFields = @($fixture.expected.result.PSObject.Properties.Name | Where-Object { $_ -notin $successEvidencePropertyNames })
        if ($unsupportedResultFields.Count -gt 0) {
            throw "Fixture '$($fixture.fixture_id)' declares success-result fields absent from evidence.schema.json: $($unsupportedResultFields -join ', ')."
        }
    }
    if ($fixture.fixture_id -ne $fixtureRef.id) { throw "Fixture path '$($fixtureRef.path)' declares '$($fixture.fixture_id)', expected '$($fixtureRef.id)'." }
    $duplicateLifecycleSteps = @($fixture.lifecycle_steps | Group-Object | Where-Object Count -gt 1 | ForEach-Object Name)
    if ($duplicateLifecycleSteps.Count -gt 0) { throw "Fixture '$($fixture.fixture_id)' contains duplicate lifecycle steps: $($duplicateLifecycleSteps -join ', ')." }
    foreach ($storyId in $fixture.story_ids) { if (-not $storyIds.ContainsKey($storyId)) { throw "Fixture '$($fixture.fixture_id)' names unknown story '$storyId'." } }
    foreach ($testId in $fixture.evidence_test_ids) { if (-not $testIds.ContainsKey($testId)) { throw "Fixture '$($fixture.fixture_id)' names unknown evidence test '$testId'." } }
    if ($fixtureRef.parity_required -and @($fixture.evidence_test_ids | Where-Object { $_ -in $parityTestIds }).Count -eq 0) {
        throw "Parity fixture '$($fixture.fixture_id)' is not bound to a manifest parity test."
    }
}

foreach ($story in $candidate.stories) {
    foreach ($id in $story.fixture_ids) { if (-not $fixtureIds.ContainsKey($id)) { throw "Story '$($story.id)' names unknown fixture '$id'." } }
    foreach ($id in $story.test_ids) { if (-not $testIds.ContainsKey($id)) { throw "Story '$($story.id)' names unknown test '$id'." } }
    foreach ($id in $story.artifact_ids) { if (-not $artifactIds.ContainsKey($id)) { throw "Story '$($story.id)' names unknown artifact '$id'." } }
}
foreach ($test in $candidate.tests) {
    foreach ($id in $test.story_ids) { if (-not $storyIds.ContainsKey($id)) { throw "Test '$($test.id)' names unknown story '$id'." } }
    foreach ($id in $test.expected_artifact_ids) { if (-not $artifactIds.ContainsKey($id)) { throw "Test '$($test.id)' names unknown artifact '$id'." } }
}
if ($candidate.candidate_id -eq "solid-feature-sprint-4") {
    $sprint4Commands = [ordered]@{
        "planar-face-document-authority-contracts" = [ordered]@{
            kind = "native"
            command = "cargo test -p crawler-part-runtime --locked planar_face"
        }
        "native-planar-face-extrude" = [ordered]@{
            kind = "native"
            command = "cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/native"
        }
        "wasm-planar-face-extrude" = [ordered]@{
            kind = "wasm"
            command = "node scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-4.json --output artifacts/solid-feature-qualification/current/runtime/release-wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm"
        }
    }
    foreach ($entry in $sprint4Commands.GetEnumerator()) {
        $test = @($candidate.tests | Where-Object id -eq $entry.Key)
        if ($test.Count -ne 1 -or [string]$test[0].kind -cne [string]$entry.Value.kind -or
            [string]$test[0].command -cne [string]$entry.Value.command) {
            throw "Sprint 4 test '$($entry.Key)' is not bound to its exact executing command identity."
        }
    }
}
if ($candidate.candidate_id -eq "solid-feature-sprint-5") {
    $sprint5FixtureIds = @(
        "cut-origin-blind-rectangle", "cut-multi-body-unrelated-preserved", "cut-origin-circle", "cut-origin-annulus", "cut-origin-arc-capsule",
        "cut-offset-plane-reverse", "cut-offset-plane-upstream-recompute", "cut-planar-face-symmetric", "cut-edit-upstream-recompute",
        "cut-save-reopen-edit", "cut-missing-stale-suppressed-target", "cut-target-cardinality-refused",
        "cut-cross-component-target-refused", "cut-no-overlap-refused", "cut-body-erasure-refused", "cut-nonmanifold-result-refused",
        "cut-invalid-support-refused", "cut-invalid-profile-refused", "cut-last-valid-recovery",
        "production-single-target-cut-lifecycle"
    )
    $actualSprint5FixtureIds = @($candidate.fixtures | ForEach-Object id)
    $actualSprint5FixtureSet = (@($actualSprint5FixtureIds | Sort-Object) -join "`n")
    $expectedSprint5FixtureSet = (@($sprint5FixtureIds | Sort-Object) -join "`n")
    if ($actualSprint5FixtureSet -cne $expectedSprint5FixtureSet -or
        @($actualSprint5FixtureIds | Group-Object | Where-Object Count -ne 1).Count -gt 0) {
        throw "Sprint 5 fixture matrix must equal the amended single-target Cut set."
    }
    $nonParitySprint5Ids = @($candidate.fixtures | Where-Object { -not $_.parity_required } | ForEach-Object id)
    if ($nonParitySprint5Ids.Count -ne 1 -or $nonParitySprint5Ids[0] -cne "production-single-target-cut-lifecycle") {
        throw "Sprint 5 must have exactly one non-parity fixture: production-single-target-cut-lifecycle."
    }
    $productionCutFixture = $fixtureDescriptors["production-single-target-cut-lifecycle"]
    $productionSeed = $productionCutFixture.input.payload.target_seed
    if ([int64]$productionSeed.width_nm -ne 40000000 -or [int64]$productionSeed.height_nm -ne 28000000 -or
        [int64]$productionSeed.distance_nm -ne 12000000) {
        throw "Sprint 5 production lifecycle descriptor must match the 40x28x12 mm qualification reference part."
    }
    $sprint5Workloads = @("cut-single-target-rectangle", "cut-single-target-annulus", "cut-single-target-failure-recovery")
    if ((@($candidate.performance_workload_ids | Sort-Object) -join "`n") -cne (($sprint5Workloads | Sort-Object) -join "`n")) {
        throw "Sprint 5 must bind exactly the three locked single-target Cut workloads, including failure recovery."
    }
    $sprint5Commands = [ordered]@{
        "single-target-cut-contracts" = [ordered]@{
            kind = "native"
            command = "cargo test -p crawler-part-runtime --locked single_target_cut"
        }
        "native-single-target-cut" = [ordered]@{
            kind = "native"
            command = "cargo run -p crawler-part-runtime --example solid_feature_evidence -- --manifest contracts/solid-feature-candidate/sprint-5.json --output artifacts/solid-feature-qualification/current/runtime/native"
        }
        "wasm-single-target-cut" = [ordered]@{
            kind = "wasm"
            command = "node scripts/export-solid-feature-wasm-evidence.mjs --manifest contracts/solid-feature-candidate/sprint-5.json --output artifacts/solid-feature-qualification/current/runtime/release-wasm --module web/crawler-app/src/generated/runtime/crawler_part_runtime.js --wasm web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm"
        }
        "single-target-cut-native-wasm-parity" = [ordered]@{
            kind = "parity"
            command = "node scripts/compare-solid-feature-parity.mjs --manifest contracts/solid-feature-candidate/sprint-5.json"
        }
        "production-single-target-cut-lifecycle" = [ordered]@{
            kind = "browser"
            command = "pnpm --dir web/crawler-app exec playwright test tests/solid-feature-cut-qualification.spec.ts --config playwright.solid-feature-qualification.config.ts"
        }
        "single-target-cut-performance-regression" = [ordered]@{
            kind = "performance"
            command = "pnpm --dir web/crawler-app exec playwright test tests/solid-feature-cut-performance.spec.ts --config playwright.solid-feature-qualification.config.ts"
        }
    }
    foreach ($entry in $sprint5Commands.GetEnumerator()) {
        $test = @($candidate.tests | Where-Object id -eq $entry.Key)
        if ($test.Count -ne 1 -or [string]$test[0].kind -cne [string]$entry.Value.kind -or
            [string]$test[0].command -cne [string]$entry.Value.command) {
            throw "Sprint 5 test '$($entry.Key)' is not bound to its exact executing command identity."
        }
    }

    foreach ($fixtureId in $sprint5FixtureIds | Where-Object { $_ -ne "production-single-target-cut-lifecycle" }) {
        $fixture = $fixtureDescriptors[$fixtureId]
        if ($null -eq $fixture) { throw "Sprint 5 fixture descriptor is absent: $fixtureId" }
        if (@($fixture.evidence_test_ids | Where-Object { $_ -eq "single-target-cut-native-wasm-parity" }).Count -ne 1) {
            throw "Sprint 5 parity fixture '$fixtureId' is not bound exactly once to the Cut parity test."
        }
        if ($fixture.input.payload.PSObject.Properties.Name -notcontains "target_body_ids") {
            throw "Sprint 5 parity fixture '$fixtureId' does not declare explicit target_body_ids."
        }
        $targets = @($fixture.input.payload.target_body_ids)
        $seed = $fixture.input.payload.target_seed
        $expectedSeed = if ($fixtureId -eq "cut-nonmanifold-result-refused") { @(10000000, 10000000, 10000000) } else { @(10000000, 6000000, 4000000) }
        if ([int64]$seed.width_nm -ne $expectedSeed[0] -or [int64]$seed.height_nm -ne $expectedSeed[1] -or [int64]$seed.distance_nm -ne $expectedSeed[2]) {
            throw "Sprint 5 parity fixture '$fixtureId' does not use its frozen target seed."
        }
        if ($fixtureId -ne "cut-target-cardinality-refused" -and $targets.Count -ne 1) {
            throw "Sprint 5 fixture '$fixtureId' must carry one explicit target body; target inference is forbidden."
        }
        if ($fixture.input.payload.direction -eq "symmetric" -and
            ([int64]$fixture.input.payload.visible_total_distance_nm -ne (2 * [int64]$fixture.input.payload.distance_nm))) {
            throw "Sprint 5 symmetric Cut fixture '$fixtureId' must bind visible total length to exactly twice the durable half distance."
        }
        if ($fixtureId -eq "cut-edit-upstream-recompute" -and
            (($fixture.input.payload.upstream_edit.profile_max_nm | ConvertTo-Json -Compress) -eq ($fixture.input.payload.profile.max_nm | ConvertTo-Json -Compress))) {
            throw "Sprint 5 upstream-edit fixture must freeze an actual profile change, not a no-op edit."
        }
        if ($fixtureId -eq "cut-save-reopen-edit" -and
            [int64]$fixture.input.payload.roundtrip_edit_distance_nm -eq [int64]$fixture.input.payload.distance_nm) {
            throw "Sprint 5 save/reopen fixture must freeze an actual distance change, not a no-op edit."
        }
        if ($fixtureId -eq "cut-offset-plane-upstream-recompute" -and
            [int64]$fixture.input.payload.support_edit.offset_nm -eq [int64]$fixture.input.payload.support.offset_nm) {
            throw "Sprint 5 support-edit fixture must freeze an actual signed-offset change, not a no-op edit."
        }
        if ($fixtureId -eq "cut-multi-body-unrelated-preserved") {
            $unrelated = $fixture.input.payload.unrelated_body_seed
            $retained = @($fixture.identity_sets.retained | Sort-Object)
            $affectedBodies = @($fixture.expected.result.affected_body_ids)
            if ($unrelated.body_id -cne "body:unrelated" -or [int64]$unrelated.distance_nm -ne 1000000 -or
                ($unrelated.profile.min_nm | ConvertTo-Json -Compress) -cne '[20000000,0]' -or
                ($unrelated.profile.max_nm | ConvertTo-Json -Compress) -cne '[22000000,2000000]' -or
                [int]$fixture.expected.result.body_count -ne 2 -or
                $affectedBodies.Count -ne 1 -or $affectedBodies[0] -cne "body:part" -or
                $fixture.expected.result.unrelated_body_id -cne "body:unrelated" -or
                $fixture.expected.result.unrelated_body_hash_unchanged -ne $true -or
                $fixture.expected.result.unrelated_body_preserved -ne $true -or
                ($retained -join "`n") -cne (@("body:part", "body:unrelated") -join "`n")) {
                throw "Sprint 5 multi-body fixture must freeze an accepted unrelated body and prove it remains exact and outside affected scope."
            }
        }
        if ($fixtureId -eq "cut-invalid-support-refused") {
            $expectedError = $fixture.expected.error
            $assertions = $fixture.expected.oracle_assertions
            $referencedIds = @($expectedError.referenced_entity_ids)
            if ($fixture.input.payload.invalid_support -cne "missing_construction_plane" -or
                $expectedError.category -cne "reference" -or $expectedError.code -cne "missing_construction_plane_support" -or
                $expectedError.field_path -cne "extrude.support" -or
                $referencedIds.Count -ne 1 -or $referencedIds[0] -cne "construction-plane:missing-cut-support" -or
                $assertions.target_body_hash_unchanged -ne $true -or
                $assertions.PSObject.Properties.Name -contains "boolean_attempted") {
                throw "Sprint 5 invalid-support fixture must lock the exact pre-Boolean support refusal without claiming Boolean execution."
            }
        }
        if ($fixtureId -eq "cut-invalid-profile-refused") {
            $expectedError = $fixture.expected.error
            $assertions = $fixture.expected.oracle_assertions
            $referencedIds = @($expectedError.referenced_entity_ids)
            if ($fixture.input.payload.invalid_profile -cne "open_loop" -or
                $expectedError.category -cne "profile" -or $expectedError.code -cne "invalid_cut_profile" -or
                $expectedError.field_path -cne "operation.profile" -or
                $referencedIds.Count -ne 1 -or $referencedIds[0] -cne "sketch:cut-invalid-profile-refused" -or
                $assertions.target_body_hash_unchanged -ne $true -or
                $assertions.PSObject.Properties.Name -contains "boolean_attempted") {
                throw "Sprint 5 invalid-profile fixture must lock the exact pre-Boolean profile refusal without claiming Boolean execution."
            }
        }
        if ($fixtureId -eq "cut-last-valid-recovery") {
            $result = $fixture.expected.result
            $expectedLifecycle = '["preview","commit","suppress","save","reopen","repair","recompute"]'
            if (($fixture.lifecycle_steps | ConvertTo-Json -Compress) -cne $expectedLifecycle -or
                $result.last_valid_result_retained -ne $true -or $result.failed_state_roundtrip -ne $true -or
                $result.evaluation_stopped_at_first_unresolved -ne $true -or $result.failure_diagnostic_roundtrip -ne $true -or
                $result.first_unresolved_input -cne "feature:sketch:cut-last-valid-recovery" -or
                $result.repair_recomputed -ne $true -or $result.repair_evaluated_cut_feature -ne $true -or
                $result.repair_transaction_recorded -ne $true -or $result.repair_result_bound -ne $true -or
                $result.feature_id_retained -ne $true -or $result.target_body_id_retained -ne $true) {
                throw "Sprint 5 last-valid recovery fixture must freeze blocked-state roundtrip and an actual Cut evaluation/result transaction after repair."
            }
        }
        if ($fixture.expected.kind -eq "success") {
            $requiredSuccessOracleFields = @(
                "retained_target_body_id", "affected_body_ids", "created_body_count", "body_count", "manifold",
                "orientation", "aabb_nm", "signed_volume_nm3", "surface_area_nm2", "centroid_nm", "analytic_classification"
            )
            $missingSuccessOracleFields = @($requiredSuccessOracleFields | Where-Object { $fixture.expected.result.PSObject.Properties.Name -notcontains $_ })
            if (@($fixture.identity_sets.retained).Count -lt 1 -or
                $missingSuccessOracleFields.Count -gt 0 -or
                $fixture.expected.result.PSObject.Properties.Name -notcontains "affected_body_ids" -or
                @($fixture.expected.result.affected_body_ids).Count -ne 1 -or
                $fixture.expected.result.PSObject.Properties.Name -notcontains "created_body_count" -or
                [int]$fixture.expected.result.created_body_count -ne 0) {
                throw "Sprint 5 successful fixture '$fixtureId' weakens geometry, retained-target, affected-body, or no-new-body oracles."
            }
        } else {
            if ($fixture.expected.oracle_assertions.explicit_target_required -ne $true -or
                $fixture.expected.oracle_assertions.implicit_target_used -ne $false -or
                $fixture.expected.oracle_assertions.accepted_state_unchanged -ne $true) {
                throw "Sprint 5 negative fixture '$fixtureId' weakens explicit-target or atomicity assertions."
            }
        }
    }
}
if (-not $artifactIds.ContainsKey($candidate.runtime_lock.wasm_artifact_id)) { throw "runtime_lock names unknown WASM artifact '$($candidate.runtime_lock.wasm_artifact_id)'." }

if ($ArtifactReady -or $QualificationReady -or $CompletenessPreflight) {
    if ($candidate.manifest_state -ne "qualification_ready") { throw "Candidate manifest_state is '$($candidate.manifest_state)'; qualification_ready is required." }
    if ([string]::IsNullOrWhiteSpace($candidate.runtime_lock.build_id)) { throw "runtime_lock.build_id is not frozen." }
    if ($candidate.runtime_lock.wasm_sha256 -notmatch '^[a-f0-9]{64}$') { throw "runtime_lock.wasm_sha256 is not frozen." }
    $runtimeArtifact = @($candidate.artifacts | Where-Object id -eq $candidate.runtime_lock.wasm_artifact_id)
    if ($runtimeArtifact.Count -ne 1 -or $runtimeArtifact[0].expected_sha256 -ne $candidate.runtime_lock.wasm_sha256) { throw "The runtime artifact digest must equal runtime_lock.wasm_sha256." }

    $artifactsToCheck = if ($ArtifactReady -and -not ($QualificationReady -or $CompletenessPreflight)) {
        @($candidate.artifacts | Where-Object { $_.required -and $_.lock_required })
    } else {
        @($candidate.artifacts | Where-Object { $_.required })
    }
    foreach ($artifact in $artifactsToCheck) {
        $path = Resolve-RepoPath $artifact.path -MustExist
        if ((Get-Item -LiteralPath $path).PSIsContainer -and -not (Get-ChildItem -LiteralPath $path -Recurse -File | Select-Object -First 1)) {
            throw "Required artifact directory '$($artifact.id)' is empty."
        }
        if ($artifact.lock_required) {
            if ($artifact.expected_sha256 -notmatch '^[a-f0-9]{64}$') { throw "Artifact '$($artifact.id)' lacks a frozen SHA-256." }
            if ((Get-Item -LiteralPath $path).PSIsContainer) { throw "Locked artifact '$($artifact.id)' must be a file." }
            $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $artifact.expected_sha256) { throw "Artifact '$($artifact.id)' digest mismatch: expected $($artifact.expected_sha256), got $actual." }
        }
    }

}

if ($QualificationReady -or $CompletenessPreflight) {
    if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) { throw "-EvidenceRoot is required for evidence-completeness validation." }
    $evidencePath = Resolve-RepoPath $EvidenceRoot -MustExist
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $parityFixtureIds = @($candidate.fixtures | Where-Object parity_required | ForEach-Object id)
    foreach ($runtimeSpec in @(@{ Name="native"; Folder="runtime/native" }, @{ Name="release_wasm"; Folder="runtime/release-wasm" })) {
        $runtimeDir = Join-Path $evidencePath $runtimeSpec.Folder
        if (-not (Test-Path -LiteralPath $runtimeDir -PathType Container)) { throw "Runtime evidence directory is absent: $runtimeDir" }
        $runtimeRecords = @{}
        foreach ($runtimeFile in Get-ChildItem -LiteralPath $runtimeDir -Filter *.json -File) {
            Assert-JsonSchema $runtimeFile.FullName (Join-Path $contractRoot "evidence.schema.json")
            $runtimeRecord = Get-Content -LiteralPath $runtimeFile.FullName -Raw | ConvertFrom-Json -Depth 100
            if ($runtimeRecord.runtime -ne $runtimeSpec.Name) { throw "Runtime record '$($runtimeFile.FullName)' has the wrong runtime." }
            if ($runtimeRecord.fixture_id -notin $parityFixtureIds) { throw "Unknown runtime evidence fixture '$($runtimeRecord.fixture_id)'." }
            if ($runtimeRecords.ContainsKey($runtimeRecord.fixture_id)) { throw "Duplicate $($runtimeSpec.Name) evidence for '$($runtimeRecord.fixture_id)'." }
            if ($runtimeRecord.candidate_id -ne $candidate.candidate_id -or $runtimeRecord.candidate_revision -ne $candidate.revision -or $runtimeRecord.manifest_sha256 -ne $manifestHash) { throw "Stale runtime evidence: $($runtimeFile.FullName)" }
            if ($runtimeRecord.status -ne "passed") { throw "Runtime evidence cannot be '$($runtimeRecord.status)': $($runtimeSpec.Name)/$($runtimeRecord.fixture_id)" }
            $runtimeRecords[$runtimeRecord.fixture_id] = $true
        }
        $missingRuntime = @($parityFixtureIds | Where-Object { -not $runtimeRecords.ContainsKey($_) })
        if ($missingRuntime.Count -gt 0) { throw "Missing $($runtimeSpec.Name) runtime evidence: $($missingRuntime -join ', ')" }
    }
    $recordsDir = Join-Path $evidencePath "records"
    if (-not (Test-Path -LiteralPath $recordsDir -PathType Container)) { throw "Evidence records directory is absent: $recordsDir" }
    $records = @()
    foreach ($recordFile in Get-ChildItem -LiteralPath $recordsDir -Filter *.json -File) {
        Assert-JsonSchema $recordFile.FullName (Join-Path $contractRoot "qualification-record.schema.json")
        $record = Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json -Depth 100
        if ($record.candidate_id -ne $candidate.candidate_id -or $record.candidate_revision -ne $candidate.revision -or $record.manifest_sha256 -ne $manifestHash) {
            throw "Stale evidence record: $($recordFile.FullName)"
        }
        if ($record.status -ne "passed") { throw "Candidate evidence cannot be '$($record.status)': $($record.subject_kind)/$($record.subject_id)" }
        $records += $record
    }
    $duplicateRecords = @($records | Group-Object { "$($_.subject_kind):$($_.subject_id)" } | Where-Object Count -gt 1)
    if ($duplicateRecords.Count -gt 0) { throw "Duplicate evidence records: $($duplicateRecords.Name -join ', ')" }

    # Browser qualification is one deterministic combined report. Every
    # manifest Playwright test ID owns exactly one suite, so a successful run
    # of one spec cannot be reused to mint records for absent specs.
    $browserManifestTests = @{}
    foreach ($test in $candidate.tests | Where-Object { $_.kind -in @("browser", "performance") -and $_.command -match "playwright\s+test" }) {
        $specs = @([regex]::Matches([string]$test.command, 'tests[/\\][^\s"'']+\.spec\.ts') | ForEach-Object { $_.Value.Replace('\', '/') } | Sort-Object -Unique)
        if ($specs.Count -ne 1) { throw "Manifest browser test '$($test.id)' must name exactly one Playwright spec." }
        $browserManifestTests[$test.id] = $specs[0]
    }
    $browserJunitPath = Join-Path $evidencePath "browser/junit.xml"
    if (-not (Test-Path -LiteralPath $browserJunitPath -PathType Leaf)) { throw "Combined browser JUnit is absent." }
    [xml]$browserJunit = Get-Content -LiteralPath $browserJunitPath -Raw
    $browserRoot = $browserJunit.testsuites
    $browserSuites = @($browserRoot.testsuite)
    $suiteIds = @($browserSuites | ForEach-Object { [string]$_.name })
    $duplicateBrowserSuites = @($suiteIds | Group-Object | Where-Object Count -ne 1)
    $missingBrowser = @($browserManifestTests.Keys | Where-Object { $_ -notin $suiteIds } | Sort-Object)
    $unexpectedBrowser = @($suiteIds | Where-Object { -not $browserManifestTests.ContainsKey($_) } | Sort-Object)
    if ($null -eq $browserRoot -or [int]$browserRoot.failures -ne 0 -or [int]$browserRoot.errors -ne 0 -or [int]$browserRoot.skipped -ne 0 -or
        $browserSuites.Count -ne $browserManifestTests.Count -or $duplicateBrowserSuites.Count -gt 0 -or
        $missingBrowser.Count -gt 0 -or $unexpectedBrowser.Count -gt 0) {
        throw "Combined browser JUnit coverage is incomplete (missing: $($missingBrowser -join ', '); unexpected: $($unexpectedBrowser -join ', '))."
    }
    $browserCaseCount = (@($browserSuites | ForEach-Object { @($_.testcase).Count }) | Measure-Object -Sum).Sum
    if ([int]$browserRoot.tests -ne $browserCaseCount) { throw "Combined browser JUnit root test count does not match its suites." }
    $browserJunitBundlePath = [IO.Path]::GetRelativePath($evidencePath, $browserJunitPath).Replace('\', '/')
    foreach ($suite in $browserSuites) {
        $id = [string]$suite.name
        if ([string]$suite.source_spec -ne $browserManifestTests[$id] -or [int]$suite.tests -lt 1 -or
            [int]$suite.failures -ne 0 -or [int]$suite.errors -ne 0 -or [int]$suite.skipped -ne 0 -or
            @($suite.testcase).Count -ne [int]$suite.tests) {
            throw "Combined browser JUnit suite '$id' is stale, incomplete, or failed."
        }
        $record = @($records | Where-Object { $_.subject_kind -eq "test" -and $_.subject_id -eq $id })
        if ($record.Count -ne 1 -or $browserJunitBundlePath -notin @($record[0].evidence_paths) -or
            [string]$record[0].details.browser_manifest_test_id -ne $id -or [string]$record[0].details.source_spec -ne $browserManifestTests[$id]) {
            throw "Browser manifest test '$id' lacks an identity-bound qualification record."
        }
    }

    # Non-parity fixtures use fixture-scoped evidence rather than native/WASM
    # parity records. Bind each record to its descriptor and, for browser
    # fixtures, to exactly one canonical manifest suite.
    $nonParityFixtureIds = @($candidate.fixtures | Where-Object { -not $_.parity_required } | ForEach-Object id)
    $fixtureEvidenceDirectory = Join-Path $evidencePath "fixtures"
    if ($nonParityFixtureIds.Count -gt 0 -and -not (Test-Path -LiteralPath $fixtureEvidenceDirectory -PathType Container)) {
        throw "Non-parity fixture evidence directory is absent."
    }
    if (Test-Path -LiteralPath $fixtureEvidenceDirectory -PathType Container) {
        $unexpectedFixtureEvidence = @(Get-ChildItem -LiteralPath $fixtureEvidenceDirectory -Filter *.json -File |
            Where-Object { $_.BaseName -notin $nonParityFixtureIds } | ForEach-Object Name)
        if ($unexpectedFixtureEvidence.Count -gt 0) { throw "Unknown non-parity fixture evidence is present: $($unexpectedFixtureEvidence -join ', ')" }
    }
    foreach ($fixtureRef in $candidate.fixtures | Where-Object { -not $_.parity_required }) {
        $fixtureEvidencePath = Join-Path $evidencePath "fixtures/$($fixtureRef.id).json"
        if (-not (Test-Path -LiteralPath $fixtureEvidencePath -PathType Leaf)) { throw "Non-parity fixture evidence is absent: $($fixtureRef.id)" }
        Assert-JsonSchema $fixtureEvidencePath (Join-Path $contractRoot "fixture-evidence.schema.json")
        $fixtureEvidence = Get-Content -LiteralPath $fixtureEvidencePath -Raw | ConvertFrom-Json -Depth 100
        $descriptorPath = Resolve-RepoPath $fixtureRef.path -MustExist
        $descriptor = Get-Content -LiteralPath $descriptorPath -Raw | ConvertFrom-Json -Depth 100
        $descriptorHash = (Get-FileHash -LiteralPath $descriptorPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($fixtureEvidence.candidate_id -ne $candidate.candidate_id -or $fixtureEvidence.candidate_revision -ne $candidate.revision -or
            $fixtureEvidence.manifest_sha256 -ne $manifestHash -or $fixtureEvidence.fixture_id -ne $fixtureRef.id -or
            $fixtureEvidence.descriptor_sha256 -ne $descriptorHash -or $fixtureEvidence.status -ne "passed" -or
            ($fixtureEvidence.input | ConvertTo-Json -Compress -Depth 100) -ne ($descriptor.input | ConvertTo-Json -Compress -Depth 100) -or
            ($fixtureEvidence.result | ConvertTo-Json -Compress -Depth 100) -ne ($descriptor.expected | ConvertTo-Json -Compress -Depth 100)) {
            throw "Non-parity fixture evidence is stale or differs from its descriptor: $($fixtureRef.id)"
        }
        $fixtureRecord = @($records | Where-Object { $_.subject_kind -eq "fixture" -and $_.subject_id -eq $fixtureRef.id })
        $fixtureEvidenceBundlePath = [IO.Path]::GetRelativePath($evidencePath, $fixtureEvidencePath).Replace('\', '/')
        if ($fixtureRecord.Count -ne 1 -or $fixtureEvidenceBundlePath -notin @($fixtureRecord[0].evidence_paths) -or
            [string]$fixtureRecord[0].details.fixture_evidence_path -ne $fixtureEvidenceBundlePath) {
            throw "Non-parity fixture '$($fixtureRef.id)' lacks a fixture-bound qualification record."
        }
        switch ($fixtureRef.id) {
            "qualification-incomplete-candidate" {
                if ($fixtureEvidence.source_kind -ne "self_test" -or $fixtureEvidence.source_id -ne "non-parity-self-tests" -or
                    $fixtureEvidence.assertions.candidate_schema_valid -ne $true -or
                    $fixtureEvidence.assertions.all_present_evidence_passed -ne $true -or
                    $fixtureEvidence.assertions.only_missing_subject -ne "fixture:extrude-origin-blind-rectangle" -or
                    [int]$fixtureEvidence.assertions.actual_subject_count -ne ([int]$fixtureEvidence.assertions.otherwise_complete_subject_count - 1)) {
                    throw "Incomplete-candidate fixture did not prove exactly one missing evidence subject."
                }
            }
            "parity-deliberate-divergence" {
                if ($fixtureEvidence.source_kind -ne "self_test" -or $fixtureEvidence.source_id -ne "non-parity-self-tests" -or
                    [double]$fixtureEvidence.assertions.native_value -ne [double]$descriptor.input.payload.native -or
                    [double]$fixtureEvidence.assertions.release_wasm_value -ne [double]$descriptor.input.payload.release_wasm -or
                    [int]$fixtureEvidence.assertions.difference_count -lt 1) {
                    throw "Deliberate-divergence fixture did not use its descriptor-declared values."
                }
            }
            "production-runtime-identity" {
                $suiteId = "production-runtime-identity"
                if ($fixtureEvidence.source_kind -ne "browser_suite" -or $fixtureEvidence.source_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.browser_manifest_test_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.source_spec -ne $browserManifestTests[$suiteId] -or
                    $fixtureEvidence.assertions.source_spec -ne $browserManifestTests[$suiteId] -or
                    $fixtureEvidence.assertions.served_wasm_sha256 -ne $candidate.runtime_lock.wasm_sha256 -or
                    $fixtureEvidence.assertions.mock_worker -ne $false -or $fixtureEvidence.assertions.production_preview -ne $true -or
                    [int]$fixtureEvidence.assertions.model_worker_count -ne 1 -or
                    $suiteId -notin $suiteIds) {
                    throw "Runtime-identity fixture is not bound to its exact passing browser suite/assertions."
                }
            }
            "production-preview-interaction" {
                $suiteId = "production-extrude-lifecycle"
                $dirty = @($fixtureEvidence.assertions.recompute_dirty_roots)
                $order = @($fixtureEvidence.assertions.recompute_evaluation_order)
                if ($fixtureEvidence.source_kind -ne "browser_suite" -or $fixtureEvidence.source_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.browser_manifest_test_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.source_spec -ne $browserManifestTests[$suiteId] -or
                    $fixtureEvidence.assertions.source_spec -ne $browserManifestTests[$suiteId] -or
                    ($fixtureEvidence.assertions.viewport | ConvertTo-Json -Compress) -ne '[1440,900]' -or
                    [int]$fixtureEvidence.assertions.playwright_workers -ne 1 -or
                    [double]$fixtureEvidence.assertions.device_scale_factor -ne 1 -or
                    [int]$fixtureEvidence.assertions.model_worker_count -ne 1 -or $dirty.Count -lt 1 -or
                    ($dirty | ConvertTo-Json -Compress) -ne ($order | ConvertTo-Json -Compress) -or
                    [double]$fixtureEvidence.assertions.stale_preview_final_distance_mm -ne 9 -or
                    $suiteId -notin $suiteIds) {
                    throw "Preview-interaction fixture is not bound to its exact passing browser suite/assertions."
                }
            }
            "extrude-stale-preview" {
                $suiteId = "production-extrude-lifecycle"
                if ($fixtureEvidence.source_kind -ne "browser_suite" -or $fixtureEvidence.source_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.browser_manifest_test_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.source_spec -ne $browserManifestTests[$suiteId] -or
                    $fixtureEvidence.assertions.source_spec -ne $browserManifestTests[$suiteId] -or
                    ($fixtureEvidence.assertions.completion_order | ConvertTo-Json -Compress) -ne '["second","first"]' -or
                    ($fixtureEvidence.assertions.requested_distances_nm | ConvertTo-Json -Compress) -ne '[4000000,9000000]' -or
                    ($fixtureEvidence.assertions.delivered_distances_nm | ConvertTo-Json -Compress) -ne '[9000000,4000000]' -or
                    [int64]$fixtureEvidence.assertions.accepted_distance_nm -ne 9000000 -or
                    $fixtureEvidence.assertions.accepted_document_unchanged_during_preview -ne $true -or
                    ($fixtureEvidence.assertions.lifecycle_steps_completed | ConvertTo-Json -Compress) -ne '["preview","cancel","commit","edit","recompute"]' -or
                    $fixtureEvidence.assertions.preview_completed -ne $true -or $fixtureEvidence.assertions.cancel_completed -ne $true -or
                    $fixtureEvidence.assertions.commit_completed -ne $true -or $fixtureEvidence.assertions.edit_completed -ne $true -or
                    $fixtureEvidence.assertions.recompute_completed -ne $true -or [int]$fixtureEvidence.assertions.model_worker_count -ne 1 -or
                    $suiteId -notin $suiteIds) {
                    throw "Stale-preview fixture is not bound to its exact reversed production worker lifecycle."
                }
            }
            "extrude-create-edit-equivalence" {
                $suiteId = "production-extrude-lifecycle"
                if ($fixtureEvidence.source_kind -ne "browser_suite" -or $fixtureEvidence.source_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.browser_manifest_test_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.source_spec -ne $browserManifestTests[$suiteId] -or
                    $fixtureEvidence.assertions.source_spec -ne $browserManifestTests[$suiteId] -or
                    ($fixtureEvidence.assertions.flows_exercised | ConvertTo-Json -Compress) -ne '["tool_first","selection_first","timeline_edit","timeline_edit_selected_region_replacement","timeline_edit_cross_sketch_replacement_rejected"]' -or
                    [int64]$fixtureEvidence.assertions.distance_nm -ne 4000000 -or
                    $fixtureEvidence.assertions.canonical_definitions_equal -ne $true -or $fixtureEvidence.assertions.camera_invariant_handle -ne $true -or
                    $fixtureEvidence.assertions.tool_first_without_profile_selection -ne $true -or
                    $fixtureEvidence.assertions.selection_first_profile_selected -ne $true -or
                    $fixtureEvidence.assertions.timeline_edit_retained_feature -ne $true -or
                    $fixtureEvidence.assertions.selected_region_replacement_persisted -ne $true -or
                    $fixtureEvidence.assertions.selected_region_replacement_source_sketch_retained -ne $true -or
                    $fixtureEvidence.assertions.selected_region_replacement_cancel_restored -ne $true -or
                    $fixtureEvidence.assertions.selected_region_replacement_feature_id_retained -ne $true -or
                    $fixtureEvidence.assertions.selected_region_replacement_body_id_retained -ne $true -or
                    $fixtureEvidence.assertions.selected_region_replacement_recompute_correct -ne $true -or
                    $fixtureEvidence.assertions.selected_region_replacement_reload_persisted -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_replacement_rejected -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_accepted_state_unchanged -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_references_unchanged -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_feature_and_body_ids_retained -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_geometry_unchanged -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_feature_count_unchanged -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_no_invalid_preview_or_commit -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_explicit_error -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_zero_preview_or_commit_dispatch -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_edit_blocked -ne $true -or
                    $fixtureEvidence.result.result.cross_sketch_error_reason_present -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_replacement_rejected -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_accepted_document_hash_unchanged -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_feature_id_retained -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_body_id_retained -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_source_sketch_reference_unchanged -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_support_reference_unchanged -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_region_reference_unchanged -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_geometry_bounds_unchanged -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_feature_count_unchanged -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_no_invalid_preview -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_no_invalid_commit -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_explicit_edit_error -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_edit_blocked -ne $true -or
                    [string]$fixtureEvidence.assertions.cross_sketch_error_reason -ne "The selected replacement profile must belong to this Extrude's source sketch and resolved support." -or
                    [int]$fixtureEvidence.assertions.cross_sketch_preview_dispatch_count -ne 0 -or
                    [int]$fixtureEvidence.assertions.cross_sketch_commit_dispatch_count -ne 0 -or
                    $fixtureEvidence.assertions.cross_sketch_recompute_unchanged -ne $true -or
                    $fixtureEvidence.assertions.cross_sketch_reload_unchanged -ne $true -or
                    ($fixtureEvidence.assertions.lifecycle_steps_completed | ConvertTo-Json -Compress) -ne '["preview","cancel","commit","edit","recompute","reload"]' -or
                    $fixtureEvidence.assertions.preview_completed -ne $true -or $fixtureEvidence.assertions.cancel_completed -ne $true -or
                    $fixtureEvidence.assertions.commit_completed -ne $true -or $fixtureEvidence.assertions.edit_completed -ne $true -or
                    $fixtureEvidence.assertions.recompute_completed -ne $true -or $fixtureEvidence.assertions.reload_completed -ne $true -or
                    ($fixtureEvidence.assertions.model_worker_counts | ConvertTo-Json -Compress) -ne '[1,1,1]' -or
                    [int]$fixtureEvidence.assertions.console_errors -ne 0 -or [int]$fixtureEvidence.assertions.page_errors -ne 0 -or
                    $suiteId -notin $suiteIds) {
                    throw "Create/edit-equivalence fixture is not bound to every declared production UI flow and lifecycle step."
                }
            }
            "production-planar-face-lifecycle" {
                $suiteId = "production-planar-face-lifecycle"
                $expectedScreenshots = @("accepted-face-extrude", "broken-last-good", "repair-preview", "repaired-reopen")
                $actualScreenshots = @($fixtureEvidence.result.result.screenshots)
                $repairKinds = @($fixtureEvidence.assertions.repair_transaction_changes | ForEach-Object kind)
                $workerUrls = @($fixtureEvidence.assertions.generated_worker_urls)
                if ($fixtureEvidence.source_kind -ne "browser_suite" -or $fixtureEvidence.source_id -ne "web/crawler-app/$($browserManifestTests[$suiteId])" -or
                    [string]$fixtureRecord[0].details.browser_manifest_test_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.source_spec -ne $browserManifestTests[$suiteId] -or
                    ($actualScreenshots | ConvertTo-Json -Compress) -ne ($expectedScreenshots | ConvertTo-Json -Compress) -or
                    ($fixtureEvidence.assertions.lifecycle_executed | ConvertTo-Json -Compress) -ne ($descriptor.lifecycle_steps | ConvertTo-Json -Compress) -or
                    ($fixtureEvidence.assertions.directions_executed | ConvertTo-Json -Compress) -ne ($descriptor.input.payload.directions | ConvertTo-Json -Compress) -or
                    ($repairKinds | ConvertTo-Json -Compress) -ne '["rebind_topology","accept_feature_result"]' -or
                    $fixtureEvidence.assertions.cancelled_repair_preview_basis.phase -ne "ready" -or
                    $fixtureEvidence.assertions.committed_repair_preview_basis.phase -ne "ready" -or
                    $fixtureEvidence.assertions.cancelled_repair_preview_basis.selected -ne $fixtureEvidence.assertions.committed_repair_preview_basis.selected -or
                    $workerUrls.Count -ne 2 -or
                    @($workerUrls | Where-Object { $_ -notmatch '/assets/(model|persistence)\.worker-[A-Za-z0-9_-]+\.js$' }).Count -ne 0 -or
                    $suiteId -notin $suiteIds) {
                    throw "Production planar-face fixture is not bound to the exact generated-WASM browser lifecycle, actual repair preview, and required screenshots."
                }
            }
            "production-single-target-cut-lifecycle" {
                $suiteId = "production-single-target-cut-lifecycle"
                $workerUrls = @($fixtureEvidence.assertions.generated_worker_urls)
                $cutAssertions = $fixtureEvidence.assertions
                $toolBindingsEqual = (($cutAssertions.tool_entry_bindings.ribbon | ConvertTo-Json -Compress -Depth 20) -ceq
                    ($cutAssertions.tool_entry_bindings.model_menu | ConvertTo-Json -Compress -Depth 20))
                $toolBinding = $cutAssertions.tool_entry_bindings.ribbon
                $staleDeliveries = @($cutAssertions.stale_preview_delivery_distances_nm)
                $staleBasisReferences = @($cutAssertions.stale_basis_diagnostic.referenced_entity_ids)
                $upstreamTransition = @($cutAssertions.upstream_dimension_transition_nm)
                $upstreamOrder = @($cutAssertions.upstream_recompute_evaluation_order)
                $workerRefusalReferences = @($cutAssertions.worker_refusal_diagnostic.referenced_entity_ids)
                $supportEditOrder = @($cutAssertions.support_edit_recompute_evaluation_order)
                $blockedOrder = @($cutAssertions.blocked_recompute_evaluation_order)
                $blockedReferences = @($cutAssertions.blocked_recompute_diagnostic.referenced_entity_ids)
                $repairedOrder = @($cutAssertions.repaired_recompute_evaluation_order)
                $repairedTransaction = $cutAssertions.repaired_recompute_transaction
                $repairedTransactionChanges = @($repairedTransaction.changes)
                $repairedResults = @($cutAssertions.repaired_recomputed_results)
                if ($fixtureEvidence.source_kind -ne "browser_suite" -or
                    $fixtureEvidence.source_id -ne "web/crawler-app/$($browserManifestTests[$suiteId])" -or
                    [string]$fixtureRecord[0].details.browser_manifest_test_id -ne $suiteId -or
                    [string]$fixtureRecord[0].details.source_spec -ne $browserManifestTests[$suiteId] -or
                    $fixtureEvidence.assertions.source_spec -ne $browserManifestTests[$suiteId] -or
                    ($fixtureEvidence.assertions.lifecycle_executed | ConvertTo-Json -Compress) -ne ($descriptor.lifecycle_steps | ConvertTo-Json -Compress) -or
                    $fixtureEvidence.assertions.explicit_target_selected -ne $true -or
                    $fixtureEvidence.assertions.preview_source -ne "worker-render-packet" -or
                    $fixtureEvidence.assertions.result_mode -ne "cut" -or
                    $fixtureEvidence.assertions.target_body_retained -ne $true -or
                    [int]$fixtureEvidence.assertions.affected_body_count -ne 1 -or
                    [int]$fixtureEvidence.assertions.created_body_count -ne 0 -or
                    $fixtureEvidence.assertions.missing_target_zero_dispatch -ne $true -or
                    $fixtureEvidence.assertions.accepted_state_unchanged_on_failure -ne $true -or
                    $cutAssertions.actual_tool_entry_parity -ne $true -or -not $toolBindingsEqual -or
                    $toolBinding.resultMode -cne "cut" -or $toolBinding.targetBodyId -cne "body:part" -or $toolBinding.bodyId -cne "body:part" -or
                    $toolBinding.support.kind -cne "origin_plane_reference" -or $toolBinding.support.plane -cne "origin-plane:xy" -or
                    @($toolBinding.profileGeometryIds).Count -lt 1 -or $cutAssertions.legacy_advanced_dispatch_observed -ne $false -or
                    $cutAssertions.removal_volume_distinguished -ne $true -or $cutAssertions.removal_preview_state.visible -ne $true -or
                    [int]$cutAssertions.removal_preview_state.triangleCount -le 0 -or $cutAssertions.removal_preview_state.color -cne "#f97316" -or
                    [double]$cutAssertions.removal_preview_state.opacity -ne 0.34 -or [string]::IsNullOrWhiteSpace([string]$cutAssertions.removal_preview_state.topologyFingerprint) -or
                    $cutAssertions.stale_preview_rejected -ne $true -or $staleDeliveries.Count -ne 2 -or
                    [int64]$staleDeliveries[0] -ne 1500000 -or [int64]$staleDeliveries[1] -ne 1250000 -or
                    $cutAssertions.stale_basis_atomic -ne $true -or $cutAssertions.stale_basis_diagnostic.code -cne "extrude_stale_preview_basis" -or
                    $cutAssertions.stale_basis_diagnostic.category -cne "stale_reference" -or $cutAssertions.stale_basis_diagnostic.field -cne "extrude.preview_basis" -or
                    $staleBasisReferences.Count -ne 1 -or $staleBasisReferences[0] -cne "body:part" -or
                    $cutAssertions.upstream_dimension_recomputed -ne $true -or $upstreamTransition.Count -ne 2 -or
                    [int64]$upstreamTransition[0] -ne 6000000 -or [int64]$upstreamTransition[1] -ne 5000000 -or
                    $upstreamOrder.Count -ne 1 -or $upstreamOrder[0] -cne $cutAssertions.feature_id -or
                    $cutAssertions.worker_refusal_atomic -ne $true -or $cutAssertions.worker_refusal_diagnostic.code -cne "missing_cut_target" -or
                    $cutAssertions.worker_refusal_diagnostic.category -cne "reference" -or $cutAssertions.worker_refusal_diagnostic.field -cne "participant_bodies.target" -or
                    $workerRefusalReferences.Count -ne 1 -or $workerRefusalReferences[0] -cne "body:missing:qualification-cut-target" -or
                    $cutAssertions.support_edit_recomputed -ne $true -or $supportEditOrder.Count -ne 1 -or
                    $supportEditOrder[0] -cne $cutAssertions.recovery_cut_feature_id -or $cutAssertions.last_valid_result_retained -ne $true -or
                    $cutAssertions.blocked_recompute_diagnostic.category -cne "reference" -or
                    $cutAssertions.blocked_recompute_diagnostic.code -cne "suppressed_required_input" -or
                    $cutAssertions.blocked_recompute_diagnostic.field -cne "recompute.required_inputs" -or
                    $cutAssertions.blocked_recompute_diagnostic.field_path -cne "recompute.required_inputs" -or
                    $blockedOrder.Count -ne 0 -or $blockedReferences.Count -ne 1 -or
                    $blockedReferences[0] -notmatch '^feature:sketch:' -or
                    $cutAssertions.failed_state_save_reopen_equal -ne $true -or $cutAssertions.reopened_failure_diagnostic_equal -ne $true -or
                    $cutAssertions.repaired_recompute_accepted -ne $true -or
                    $cutAssertions.repaired_recompute_requested_from -cne $cutAssertions.recovery_cut_feature_id -or
                    $repairedOrder.Count -ne 1 -or $repairedOrder[0] -cne $cutAssertions.recovery_cut_feature_id -or
                    [string]::IsNullOrWhiteSpace([string]$repairedTransaction.id) -or
                    [int64]$repairedTransaction.result_revision -le [int64]$repairedTransaction.base_revision -or
                    $repairedTransactionChanges.Count -ne 1 -or
                    $repairedTransactionChanges[0].kind -cne "accept_feature_result" -or
                    $repairedTransactionChanges[0].feature -cne $cutAssertions.recovery_cut_feature_id -or
                    $repairedTransactionChanges[0].body -cne "body:part" -or
                    $repairedResults.Count -ne 1 -or $repairedResults[0].feature -cne $cutAssertions.recovery_cut_feature_id -or
                    $repairedResults[0].body -cne "body:part" -or
                    $cutAssertions.repaired_feature_id_retained -ne $true -or $cutAssertions.repaired_target_body_id_retained -ne $true -or
                    $cutAssertions.repaired_body_set_retained -ne $true -or $cutAssertions.recovery_screenshot -cne "cut-last-valid-recovery" -or
                    $workerUrls.Count -lt 1 -or
                    @($workerUrls | Where-Object { $_ -notmatch '/assets/(model|persistence)\.worker-[A-Za-z0-9_-]+\.js$' }).Count -ne 0 -or
                    [int]$fixtureEvidence.assertions.console_errors -ne 0 -or [int]$fixtureEvidence.assertions.page_errors -ne 0 -or
                    $suiteId -notin $suiteIds) {
                    throw "Production single-target Cut fixture is not bound to explicit-target generated-worker lifecycle evidence."
                }
            }
            default { throw "No completeness contract exists for non-parity fixture '$($fixtureRef.id)'." }
        }
    }

    $requiredSubjects = @()
    $requiredSubjects += $candidate.stories | Where-Object disposition -eq "required" | ForEach-Object { "story:$($_.id)" }
    $requiredSubjects += $candidate.fixtures | ForEach-Object { "fixture:$($_.id)" }
    $requiredSubjects += $candidate.tests | Where-Object { -not ($CompletenessPreflight -and $_.id -eq "candidate-evidence-completeness") } | ForEach-Object { "test:$($_.id)" }
    $requiredSubjects += $candidate.artifacts | Where-Object required | ForEach-Object { "artifact:$($_.id)" }
    $knownSubjects = @{}
    $candidate.stories | ForEach-Object { $knownSubjects["story:$($_.id)"] = $true }
    $candidate.fixtures | ForEach-Object { $knownSubjects["fixture:$($_.id)"] = $true }
    $candidate.tests | ForEach-Object { $knownSubjects["test:$($_.id)"] = $true }
    $candidate.artifacts | ForEach-Object { $knownSubjects["artifact:$($_.id)"] = $true }
    $actualSubjects = @{}; $records | ForEach-Object { $actualSubjects["$($_.subject_kind):$($_.subject_id)"] = $true }
    foreach ($subject in $actualSubjects.Keys) { if (-not $knownSubjects.ContainsKey($subject)) { throw "Unknown evidence subject '$subject'." } }
    $missing = @($requiredSubjects | Where-Object { -not $actualSubjects.ContainsKey($_) })
    if ($missing.Count -gt 0) { throw "Missing evidence records: $($missing -join ', ')" }
}

Write-Host "Solid-feature candidate manifest validation passed: $($candidate.candidate_id) revision $($candidate.revision)." -ForegroundColor Green
