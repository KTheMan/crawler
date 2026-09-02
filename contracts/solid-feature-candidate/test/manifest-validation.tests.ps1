$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$validator = Join-Path $root "scripts/test-solid-feature-candidate.ps1"
$harness = Join-Path $root "scripts/qualify-solid-features.ps1"
$manifests = @(
    (Join-Path $root "contracts/solid-feature-candidate/sprint-1.json"),
    (Join-Path $root "contracts/solid-feature-candidate/sprint-2.json"),
    (Join-Path $root "contracts/solid-feature-candidate/sprint-3.json"),
    (Join-Path $root "contracts/solid-feature-candidate/sprint-4.json"),
    (Join-Path $root "contracts/solid-feature-candidate/sprint-5.json")
)
$incompleteManifest = Join-Path $root "contracts/solid-feature-candidate/testdata/intentionally-incomplete-candidate.json"
$failures = [Collections.Generic.List[string]]::new()

function Invoke-Validator {
    param([string]$Path, [switch]$QualificationReady)
    $arguments = @("-NoProfile", "-File", $validator, "-Manifest", $Path)
    if ($QualificationReady) { $arguments += "-QualificationReady" }
    & pwsh @arguments *> $null
    return $LASTEXITCODE
}

foreach ($manifest in $manifests) {
    if ((Invoke-Validator $manifest) -ne 0) { $failures.Add("checked-in manifest '$manifest' did not pass structural validation") }
}
if ((Invoke-Validator $incompleteManifest) -eq 0) { $failures.Add("the checked-in intentionally incomplete candidate passed validation") }
& pwsh -NoProfile -File $harness -Manifest "contracts/solid-feature-candidate/testdata/intentionally-incomplete-candidate.json" *> $null
if ($LASTEXITCODE -eq 0) { $failures.Add("the checked-in intentionally incomplete candidate passed the qualification harness") }

$temporary = Join-Path $root ".tmp/crawler-solid-feature-candidate-tests-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $pending = Get-Content -LiteralPath $manifests[2] -Raw | ConvertFrom-Json -Depth 100
    $pending.manifest_state = "scope_frozen_artifacts_pending"
    $pending.runtime_lock.build_id = $null
    $pending.runtime_lock.wasm_sha256 = $null
    @($pending.artifacts | Where-Object id -eq $pending.runtime_lock.wasm_artifact_id)[0].expected_sha256 = $null
    $pendingPath = Join-Path $temporary "artifact-pending.json"
    $pending | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $pendingPath -Encoding utf8NoBOM
    if ((Invoke-Validator $pendingPath -QualificationReady) -eq 0) { $failures.Add("an artifact-pending candidate incorrectly passed qualification-ready validation") }

    $duplicate = Get-Content -LiteralPath $manifests[0] -Raw | ConvertFrom-Json -Depth 100
    $duplicate.stories = @($duplicate.stories) + @($duplicate.stories[0])
    $duplicatePath = Join-Path $temporary "duplicate.json"
    $duplicate | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $duplicatePath -Encoding utf8NoBOM
    if ((Invoke-Validator $duplicatePath) -eq 0) { $failures.Add("a duplicate story ID passed validation") }

    $invalidSprint = Get-Content -LiteralPath $manifests[1] -Raw | ConvertFrom-Json -Depth 100
    $invalidSprint.stories[0].id = "E3D-S0-01"
    $invalidSprintPath = Join-Path $temporary "invalid-sprint-id.json"
    $invalidSprint | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $invalidSprintPath -Encoding utf8NoBOM
    if ((Invoke-Validator $invalidSprintPath) -eq 0) { $failures.Add("an invalid sprint story ID passed validation") }

    $unknownWorkload = Get-Content -LiteralPath $manifests[2] -Raw | ConvertFrom-Json -Depth 100
    $unknownWorkload.performance_workload_ids = @("extrude-offset-plane-not-declared")
    $unknownWorkloadPath = Join-Path $temporary "unknown-performance-workload.json"
    $unknownWorkload | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $unknownWorkloadPath -Encoding utf8NoBOM
    if ((Invoke-Validator $unknownWorkloadPath) -eq 0) { $failures.Add("an unknown candidate performance workload passed validation") }

    foreach ($testId in @("planar-face-document-authority-contracts", "native-planar-face-extrude", "wasm-planar-face-extrude")) {
        $wrongIdentity = Get-Content -LiteralPath $manifests[3] -Raw | ConvertFrom-Json -Depth 100
        @($wrongIdentity.tests | Where-Object id -eq $testId)[0].command = "node --test web/worker-spike/worker-spike.test.mjs"
        $wrongIdentityPath = Join-Path $temporary ("wrong-{0}.json" -f $testId)
        $wrongIdentity | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $wrongIdentityPath -Encoding utf8NoBOM
        if ((Invoke-Validator $wrongIdentityPath) -eq 0) { $failures.Add("Sprint 4 test '$testId' accepted an unrelated command identity") }
    }

    foreach ($testId in @(
        "single-target-cut-contracts", "native-single-target-cut", "wasm-single-target-cut",
        "single-target-cut-native-wasm-parity", "production-single-target-cut-lifecycle",
        "single-target-cut-performance-regression"
    )) {
        $wrongIdentity = Get-Content -LiteralPath $manifests[4] -Raw | ConvertFrom-Json -Depth 100
        @($wrongIdentity.tests | Where-Object id -eq $testId)[0].command = "node --test web/worker-spike/worker-spike.test.mjs"
        $wrongIdentityPath = Join-Path $temporary ("wrong-sprint5-{0}.json" -f $testId)
        $wrongIdentity | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $wrongIdentityPath -Encoding utf8NoBOM
        if ((Invoke-Validator $wrongIdentityPath) -eq 0) { $failures.Add("Sprint 5 test '$testId' accepted an unrelated command identity") }
    }

    $implicitTarget = Get-Content -LiteralPath $manifests[4] -Raw | ConvertFrom-Json -Depth 100
    $implicitTargetFixtureRef = @($implicitTarget.fixtures | Where-Object id -eq "cut-origin-blind-rectangle")[0]
    $implicitTargetDescriptor = Get-Content -LiteralPath (Join-Path $root $implicitTargetFixtureRef.path) -Raw | ConvertFrom-Json -Depth 100
    $implicitTargetDescriptor.input.payload.PSObject.Properties.Remove("target_body_ids")
    $implicitTargetPath = Join-Path $temporary "implicit-target-fixture.json"
    $implicitTargetDescriptor | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $implicitTargetPath -Encoding utf8NoBOM
    $implicitTargetFixtureRef.path = [IO.Path]::GetRelativePath($root, $implicitTargetPath).Replace('\', '/')
    $implicitTargetManifestPath = Join-Path $temporary "implicit-target-manifest.json"
    $implicitTarget | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $implicitTargetManifestPath -Encoding utf8NoBOM
    if ((Invoke-Validator $implicitTargetManifestPath) -eq 0) { $failures.Add("a Sprint 5 fixture with an inferred/implicit target passed validation") }

    $weakIdentity = Get-Content -LiteralPath $manifests[4] -Raw | ConvertFrom-Json -Depth 100
    $weakIdentityFixtureRef = @($weakIdentity.fixtures | Where-Object id -eq "cut-origin-blind-rectangle")[0]
    $weakIdentityDescriptor = Get-Content -LiteralPath (Join-Path $root $weakIdentityFixtureRef.path) -Raw | ConvertFrom-Json -Depth 100
    $weakIdentityDescriptor.identity_sets.retained = @()
    $weakIdentityPath = Join-Path $temporary "weak-retained-identity-fixture.json"
    $weakIdentityDescriptor | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $weakIdentityPath -Encoding utf8NoBOM
    $weakIdentityFixtureRef.path = [IO.Path]::GetRelativePath($root, $weakIdentityPath).Replace('\', '/')
    $weakIdentityManifestPath = Join-Path $temporary "weak-retained-identity-manifest.json"
    $weakIdentity | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $weakIdentityManifestPath -Encoding utf8NoBOM
    if ((Invoke-Validator $weakIdentityManifestPath) -eq 0) { $failures.Add("a Sprint 5 success fixture with no retained target identity passed validation") }

    $weakOracle = Get-Content -LiteralPath $manifests[4] -Raw | ConvertFrom-Json -Depth 100
    $weakOracleFixtureRef = @($weakOracle.fixtures | Where-Object id -eq "cut-origin-blind-rectangle")[0]
    $weakOracleDescriptor = Get-Content -LiteralPath (Join-Path $root $weakOracleFixtureRef.path) -Raw | ConvertFrom-Json -Depth 100
    $weakOracleDescriptor.expected.result.PSObject.Properties.Remove("affected_body_ids")
    $weakOraclePath = Join-Path $temporary "weak-affected-body-oracle-fixture.json"
    $weakOracleDescriptor | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $weakOraclePath -Encoding utf8NoBOM
    $weakOracleFixtureRef.path = [IO.Path]::GetRelativePath($root, $weakOraclePath).Replace('\', '/')
    $weakOracleManifestPath = Join-Path $temporary "weak-affected-body-oracle-manifest.json"
    $weakOracle | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $weakOracleManifestPath -Encoding utf8NoBOM
    if ((Invoke-Validator $weakOracleManifestPath) -eq 0) { $failures.Add("a Sprint 5 success fixture with a weakened affected-body oracle passed validation") }

    $weakGeometry = Get-Content -LiteralPath $manifests[4] -Raw | ConvertFrom-Json -Depth 100
    $weakGeometryFixtureRef = @($weakGeometry.fixtures | Where-Object id -eq "cut-origin-blind-rectangle")[0]
    $weakGeometryDescriptor = Get-Content -LiteralPath (Join-Path $root $weakGeometryFixtureRef.path) -Raw | ConvertFrom-Json -Depth 100
    $weakGeometryDescriptor.expected.result.PSObject.Properties.Remove("signed_volume_nm3")
    $weakGeometryPath = Join-Path $temporary "weak-geometry-oracle-fixture.json"
    $weakGeometryDescriptor | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $weakGeometryPath -Encoding utf8NoBOM
    $weakGeometryFixtureRef.path = [IO.Path]::GetRelativePath($root, $weakGeometryPath).Replace('\', '/')
    $weakGeometryManifestPath = Join-Path $temporary "weak-geometry-oracle-manifest.json"
    $weakGeometry | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $weakGeometryManifestPath -Encoding utf8NoBOM
    if ((Invoke-Validator $weakGeometryManifestPath) -eq 0) { $failures.Add("a Sprint 5 success fixture with a weakened geometry oracle passed validation") }

    $hash = "0" * 64
    $nestedEvidence = [ordered]@{
        schema_version = 1; candidate_id = "schema-probe"; candidate_revision = 1
        manifest_sha256 = $hash; fixture_id = "nested-matrix"; fixture_descriptor_sha256 = $hash
        normalized_input_sha256 = $hash; runtime = "native"; status = "passed"
        recorded_at = "2026-08-28T00:00:00Z"
        result = [ordered]@{
            kind = "success"; body_count = 1; manifold = $true; orientation = "outward"
            aabb_nm = @(0, 0, 0, 1, 1, 1); signed_volume_nm3 = 1; surface_area_nm2 = 6
            centroid_nm = @(0.5, 0.5, 0.5); analytic_classification = @("plane")
            stable_identity_sets = [ordered]@{ retained = @(); replaced = @() }
            canonical_document_hash = $hash
        }
        oracle_assertions = [ordered]@{
            cases = @([ordered]@{ support = "origin.xy"; expected_bounds_nm = @(0, 0, 0, 1, 1, 1) })
        }
        executed_lifecycle_steps = @("preview", "commit")
        accepted_document_hash_before = $hash; accepted_document_hash_after = $hash
        body_hashes_before = @(); body_hashes_after = @($hash)
    }
    $evidenceSchema = Join-Path $root "contracts/solid-feature-candidate/evidence.schema.json"
    $nestedEvidencePath = Join-Path $temporary "nested-evidence.json"
    $nestedEvidence | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $nestedEvidencePath -Encoding utf8NoBOM
    if (-not (Test-Json -LiteralPath $nestedEvidencePath -SchemaFile $evidenceSchema -ErrorAction SilentlyContinue)) {
        $failures.Add("nested matrix oracle evidence did not pass the runtime evidence schema")
    }
    $nestedEvidence.oracle_assertions.cases[0] = [ordered]@{ BadKey = "not-canonical" }
    $nestedEvidence | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $nestedEvidencePath -Encoding utf8NoBOM
    if (Test-Json -LiteralPath $nestedEvidencePath -SchemaFile $evidenceSchema -ErrorAction SilentlyContinue) {
        $failures.Add("a nested oracle property outside canonical snake_case passed the runtime evidence schema")
    }

    $frame = [ordered]@{
        origin_nm = @(0, 0, 10000000)
        x_axis_millionths = @(1000000, 0, 0)
        y_axis_millionths = @(0, 1000000, 0)
        normal_millionths = @(0, 0, 1000000)
    }
    $roundTrip = [ordered]@{
        local_nm = @(1000000, 2000000, 3000000)
        world_nm = @(1000000, 2000000, 13000000)
        recovered_local_nm = @(1000000, 2000000, 3000000)
        exact = $true
    }
    $geometryOracle = [ordered]@{
        aabb_nm = @(0, 0, 10000000, 4000000, 3000000, 12000000)
        centroid_nm = @(2000000, 1500000, 11000000)
        signed_volume_nm3 = 24000000000000000000.0
        surface_area_nm2 = 52000000000000.0
        orientation = "outward"
        analytic_classification = @("plane")
        body_count = 1
        canonical_document_hash = $hash
    }
    $geometryCases = [ordered]@{}
    foreach ($caseId in @(
        "cap_positive_z:positive", "cap_positive_z:negative", "cap_positive_z:symmetric",
        "cap_negative_z:positive", "cap_negative_z:negative", "cap_negative_z:symmetric",
        "side_positive_x:positive", "side_positive_x:negative", "side_positive_x:symmetric",
        "cap_positive_z:positive:line_arc_capsule", "cap_positive_z:positive:circle_annulus_with_hole"
    )) {
        $geometryCases["extrude-planar-face-orientation-matrix:$caseId"] = $geometryOracle
    }
    $nestedEvidence.oracle_assertions = [ordered]@{
        case_count = 11
        authority_source = "accepted_body_snapshot_solid_json"
        support_frames = [ordered]@{
            cap_positive_z = $frame
            cap_negative_z = $frame
            side_positive_x = $frame
        }
        exact_coordinate_round_trips = [ordered]@{
            cap_positive_z = $roundTrip
            cap_negative_z = $roundTrip
            side_positive_x = $roundTrip
        }
        geometry_oracles = $geometryCases
    }
    $nestedEvidence | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $nestedEvidencePath -Encoding utf8NoBOM
    if (-not (Test-Json -LiteralPath $nestedEvidencePath -SchemaFile $evidenceSchema -ErrorAction SilentlyContinue)) {
        $failures.Add("the exact bounded planar geometry/frame/round-trip oracle structure did not pass the runtime evidence schema")
    }

    $firstGeometryCase = @($geometryCases.Keys)[0]
    $geometryCases[$firstGeometryCase].BadKey = "not-canonical"
    $nestedEvidence | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $nestedEvidencePath -Encoding utf8NoBOM
    if (Test-Json -LiteralPath $nestedEvidencePath -SchemaFile $evidenceSchema -ErrorAction SilentlyContinue) {
        $failures.Add("an unknown noncanonical property inside a frozen geometry oracle passed the runtime evidence schema")
    }
    $geometryCases[$firstGeometryCase].Remove("BadKey")
    $removedGeometryCase = $geometryCases[$firstGeometryCase]
    $geometryCases.Remove($firstGeometryCase)
    $geometryCases["extrude-planar-face-orientation-matrix:unknown_case"] = $removedGeometryCase
    $nestedEvidence | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $nestedEvidencePath -Encoding utf8NoBOM
    if (Test-Json -LiteralPath $nestedEvidencePath -SchemaFile $evidenceSchema -ErrorAction SilentlyContinue) {
        $failures.Add("an unknown frozen planar geometry case identifier passed the runtime evidence schema")
    }
}
finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}
Write-Host "Solid-feature candidate negative and positive validation tests passed." -ForegroundColor Green
