[CmdletBinding()]
param(
    [string]$Manifest = "contracts/solid-feature-candidate/sprint-1.json",
    [string]$NativeEvidenceCommand,
    [string]$WasmEvidenceCommand
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestPath = [IO.Path]::GetFullPath((Join-Path $root $Manifest))
$evidenceRoot = Join-Path $root "artifacts/solid-feature-qualification/current"
$immutableRoot = Join-Path $root "artifacts/solid-feature-qualification/runs"
$commandRecords = [Collections.Generic.List[object]]::new()
$previousTarget = $env:CARGO_TARGET_DIR
$previousNonParityEvidenceRoot = $env:SOLID_FEATURE_NON_PARITY_EVIDENCE_ROOT
. (Join-Path $PSScriptRoot "solid-feature-source-snapshot.ps1")
. (Join-Path $PSScriptRoot "solid-feature-command-provenance.ps1")

function Assert-UnderRoot {
    param([Parameter(Mandatory)] [string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Qualification path escapes repository: $full" }
    return $full
}

function Invoke-Step {
    param(
        [Parameter(Mandatory)] [string]$Id,
        [Parameter(Mandatory)] [string]$Label,
        [Parameter(Mandatory)] [object[]]$Invocations,
        [Parameter(Mandatory)] [scriptblock]$Command
    )
    if ($Invocations.Count -eq 0) { throw "Qualification step '$Id' has no structured command invocation." }
    foreach ($invocation in $Invocations) { Assert-SolidFeatureCommandInvocation $invocation | Out-Null }
    Write-Host "`n==> $Label" -ForegroundColor Cyan
    $started = [DateTimeOffset]::UtcNow
    $log = Join-Path $evidenceRoot "logs/$Id.log"
    New-Item -ItemType Directory -Force (Split-Path -Parent $log) | Out-Null
    # Some PowerShell steps emit only host/information output. Create the log
    # eagerly so a successful silent step still has a durable command artifact.
    New-Item -ItemType File -Force $log | Out-Null
    $global:LASTEXITCODE = 0
    try {
        & $Command 2>&1 | Tee-Object -FilePath $log
        $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    }
    catch {
        $_ | Out-String | Tee-Object -FilePath $log -Append | Write-Host
        $exitCode = 1
    }
    $commandRecords.Add([ordered]@{
        id=$Id; label=$Label; started_at=$started.ToString('o'); finished_at=[DateTimeOffset]::UtcNow.ToString('o'); exit_code=$exitCode;
        log=("logs/{0}.log" -f $Id); invocations=@($Invocations); rerun=(@($Invocations | ForEach-Object rerun) -join '; ')
    })
    $commandRecords | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $evidenceRoot "commands.json") -Encoding utf8NoBOM
    if ($exitCode -ne 0) { throw "$Label failed with exit code $exitCode" }
}

function Get-FileSetHash {
    param([Parameter(Mandatory)] [string[]]$Paths)
    $entries = foreach ($path in $Paths | Sort-Object) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Generated artifact is absent: $path" }
        "$((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant())  $([IO.Path]::GetRelativePath($root, $path).Replace('\','/'))"
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($entries -join "`n"))
    $stream = [IO.MemoryStream]::new($bytes)
    try { return (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash.ToLowerInvariant() } finally { $stream.Dispose() }
}

function Assert-SourceSnapshotUnchanged {
    param(
        [Parameter(Mandatory)] [object]$Expected,
        [Parameter(Mandatory)] [object]$Actual,
        [Parameter(Mandatory)] [string]$Phase
    )
    if ($Expected.sha256 -cne $Actual.sha256 -or $Expected.entry_count -ne $Actual.entry_count) {
        throw "Git-visible source changed after qualification started ($Phase): expected $($Expected.sha256), observed $($Actual.sha256)."
    }
}

function Assert-EnvironmentProfile {
    $profile = Get-Content -LiteralPath (Join-Path $root "contracts/solid-feature-candidate/qualification-environment.v1.json") -Raw | ConvertFrom-Json
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $profile.operating_system.platform -ne "win32") { throw "Host OS is outside the qualification profile." }
    $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    if ($architecture -notin @($profile.operating_system.architectures)) { throw "Host architecture '$architecture' is outside the qualification profile." }
    if ([Environment]::ProcessorCount -lt $profile.host.minimum_logical_processors) { throw "Host has fewer logical processors than the qualification profile." }
    try {
        $memory = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory
    }
    catch {
        # Managed qualification shells may deny CIM/WMI even though querying
        # the local host's physical-memory total through the Win32 API is
        # permitted. Keep the same physical-memory assertion rather than
        # substituting process-available or GC-limit values.
        if (-not ("SolidFeatureQualification.NativeMemory" -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace SolidFeatureQualification {
    public static class NativeMemory {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct MEMORYSTATUSEX {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX status);

        public static ulong TotalPhysicalBytes() {
            var status = new MEMORYSTATUSEX();
            status.dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>();
            if (!GlobalMemoryStatusEx(ref status)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            return status.ullTotalPhys;
        }
    }
}
'@
        }
        $memory = [SolidFeatureQualification.NativeMemory]::TotalPhysicalBytes()
    }
    if ($memory -lt $profile.host.minimum_memory_bytes) { throw "Host memory is below the qualification profile." }
    $chromeCandidates = @("$env:ProgramFiles/Google/Chrome/Application/chrome.exe", "${env:ProgramFiles(x86)}/Google/Chrome/Application/chrome.exe", "$env:LOCALAPPDATA/Google/Chrome/Application/chrome.exe")
    $chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $chrome) { throw "Google Chrome required by the qualification profile was not found." }
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($chrome).FileVersion
    $major = [int]($version.Split('.')[0])
    if ($major -lt $profile.browser.minimum_major_version -or $major -gt $profile.browser.maximum_major_version) { throw "Chrome $version is outside the qualification range." }
    return [ordered]@{ profile_id=$profile.profile_id; os=[Runtime.InteropServices.RuntimeInformation]::OSDescription; architecture=$architecture; logical_processors=[Environment]::ProcessorCount; memory_bytes=$memory; chrome_path=$chrome; chrome_version=$version; headless=$profile.browser.headless; viewport=$profile.viewport; workers=$profile.execution.workers; port=$profile.execution.production_port }
}

try {
    Push-Location $root
    $manifestRelative = [IO.Path]::GetRelativePath($root, $manifestPath).Replace('\', '/')
    $candidateStructuralArgs = @("-NoProfile", "-File", "scripts/test-solid-feature-candidate.ps1", "-Manifest", $manifestRelative)
    $candidateArtifactReadyArgs = $candidateStructuralArgs + @("-ArtifactReady")
    $candidateStructuralInvocation = New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv $candidateStructuralArgs -SourceId "qualification:preflight-candidate-structure"
    $candidateArtifactReadyInvocation = New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv $candidateArtifactReadyArgs -SourceId "qualification:preflight-artifact-lock"
    & pwsh @candidateStructuralArgs
    if ($LASTEXITCODE -ne 0) { throw "Candidate structural preflight failed with exit code $LASTEXITCODE." }
    & pwsh @candidateArtifactReadyArgs
    if ($LASTEXITCODE -ne 0) { throw "Candidate artifact-lock preflight failed with exit code $LASTEXITCODE." }

    # Reject a missing or altered exporter command before rotating any existing
    # staging evidence. These are the only exporter invocations this harness
    # will execute; the same structured objects are persisted later.
    $preflightNativeArgs = @(
        "run", "-p", "crawler-part-runtime", "--example", "solid_feature_evidence", "--",
        "--manifest", $manifestRelative,
        "--output", "artifacts/solid-feature-qualification/current/runtime/native"
    )
    $preflightWasmArgs = @(
        "scripts/export-solid-feature-wasm-evidence.mjs", "--manifest", $manifestRelative,
        "--output", "artifacts/solid-feature-qualification/current/runtime/release-wasm",
        "--module", "web/crawler-app/src/generated/runtime/crawler_part_runtime.js",
        "--wasm", "web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm"
    )
    $preflightNativeCommand = Get-SolidFeatureCommandRerun -Executable "cargo" -Argv $preflightNativeArgs
    $preflightWasmCommand = Get-SolidFeatureCommandRerun -Executable "node" -Argv $preflightWasmArgs
    if ([string]::IsNullOrWhiteSpace($NativeEvidenceCommand) -or $NativeEvidenceCommand.Trim() -cne $preflightNativeCommand) {
        throw "NativeEvidenceCommand is required and must equal: $preflightNativeCommand"
    }
    if ([string]::IsNullOrWhiteSpace($WasmEvidenceCommand) -or $WasmEvidenceCommand.Trim() -cne $preflightWasmCommand) {
        throw "WasmEvidenceCommand is required and must equal: $preflightWasmCommand"
    }

    Assert-UnderRoot $evidenceRoot | Out-Null
    Assert-UnderRoot $immutableRoot | Out-Null
    if (Test-Path -LiteralPath $evidenceRoot) {
        $archivePath = Assert-UnderRoot (Join-Path $immutableRoot ("{0}-incomplete" -f [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')))
        New-Item -ItemType Directory -Force $immutableRoot | Out-Null
        Move-Item -LiteralPath $evidenceRoot -Destination $archivePath
        Write-Host "Archived the previous staging bundle without modification: $archivePath" -ForegroundColor Yellow
    }
    New-Item -ItemType Directory -Force $evidenceRoot, (Join-Path $evidenceRoot "runtime/native"), (Join-Path $evidenceRoot "runtime/release-wasm"), (Join-Path $evidenceRoot "browser/screenshots"), (Join-Path $evidenceRoot "performance"), (Join-Path $evidenceRoot "migration"), (Join-Path $evidenceRoot "records") | Out-Null
    $env:CARGO_TARGET_DIR = Join-Path $root "target/solid-feature-qualification"

    $candidate = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -Depth 100
    $manifestRelative = [IO.Path]::GetRelativePath($root, $manifestPath).Replace('\', '/')
    $nativeEvidenceArgs = @(
        "run", "-p", "crawler-part-runtime", "--example", "solid_feature_evidence", "--",
        "--manifest", $manifestRelative,
        "--output", "artifacts/solid-feature-qualification/current/runtime/native"
    )
    $wasmEvidenceArgs = @(
        "scripts/export-solid-feature-wasm-evidence.mjs",
        "--manifest", $manifestRelative,
        "--output", "artifacts/solid-feature-qualification/current/runtime/release-wasm",
        "--module", "web/crawler-app/src/generated/runtime/crawler_part_runtime.js",
        "--wasm", "web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm"
    )
    $nativeEvidenceInvocation = New-SolidFeatureCommandInvocation -Executable "cargo" -Argv $nativeEvidenceArgs -SourceId "qualification:native-evidence"
    $wasmEvidenceInvocation = New-SolidFeatureCommandInvocation -Executable "node" -Argv $wasmEvidenceArgs -SourceId "qualification:wasm-evidence"
    $expectedNativeEvidenceCommand = [string]$nativeEvidenceInvocation.rerun
    $expectedWasmEvidenceCommand = [string]$wasmEvidenceInvocation.rerun
    if ([string]::IsNullOrWhiteSpace($NativeEvidenceCommand) -or [string]::IsNullOrWhiteSpace($WasmEvidenceCommand)) {
        throw "NativeEvidenceCommand and WasmEvidenceCommand are required and must match the manifest-bound exporter commands."
    }
    if ($NativeEvidenceCommand.Trim() -cne $expectedNativeEvidenceCommand) {
        throw "NativeEvidenceCommand is not the manifest-bound exporter command. Expected: $expectedNativeEvidenceCommand"
    }
    if ($WasmEvidenceCommand.Trim() -cne $expectedWasmEvidenceCommand) {
        throw "WasmEvidenceCommand is not the manifest-bound exporter command. Expected: $expectedWasmEvidenceCommand"
    }
    $qualificationInvocation = New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @(
        "-NoProfile", "-File", "scripts/qualify-solid-features.ps1",
        "-Manifest", $manifestRelative,
        "-NativeEvidenceCommand", $expectedNativeEvidenceCommand,
        "-WasmEvidenceCommand", $expectedWasmEvidenceCommand
    ) -SourceId "qualification:entrypoint"
    $completenessPreflightArgs = @(
        "-NoProfile", "-File", "scripts/test-solid-feature-candidate.ps1", "-Manifest", $manifestRelative,
        "-EvidenceRoot", "artifacts/solid-feature-qualification/current", "-CompletenessPreflight"
    )
    $qualificationReadyArgs = @(
        "-NoProfile", "-File", "scripts/test-solid-feature-candidate.ps1", "-Manifest", $manifestRelative,
        "-EvidenceRoot", "artifacts/solid-feature-qualification/current", "-QualificationReady"
    )
    $completenessPreflightInvocation = New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv $completenessPreflightArgs -SourceId "qualification:completeness-preflight"
    $qualificationReadyInvocation = New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv $qualificationReadyArgs -SourceId "qualification:qualification-ready"
    # The manifest-locked build identity must be present while Vite builds the
    # production shell, not injected only when the browser starts.
    $env:SOLID_FEATURE_RUNTIME_BUILD_ID = $candidate.runtime_lock.build_id
    $env:SOLID_FEATURE_WASM_SHA256 = $candidate.runtime_lock.wasm_sha256
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $environment = Assert-EnvironmentProfile
    $gitProbeArgs = @("rev-parse", "HEAD")
    $rustcProbeArgs = @("--version")
    $cargoProbeArgs = @("--version")
    $nodeProbeArgs = @("--version")
    $pnpmProbeArgs = @("--dir", "web/crawler-app", "--version")
    $identityProbeInvocations = [ordered]@{
        git = New-SolidFeatureCommandInvocation -Executable "git" -Argv $gitProbeArgs -SourceId "qualification:identity-git"
        rustc = New-SolidFeatureCommandInvocation -Executable "rustc" -Argv $rustcProbeArgs -SourceId "qualification:identity-rustc"
        cargo = New-SolidFeatureCommandInvocation -Executable "cargo" -Argv $cargoProbeArgs -SourceId "qualification:identity-cargo"
        node = New-SolidFeatureCommandInvocation -Executable "node" -Argv $nodeProbeArgs -SourceId "qualification:identity-node"
        pnpm = New-SolidFeatureCommandInvocation -Executable "pnpm" -Argv $pnpmProbeArgs -SourceId "qualification:identity-pnpm"
    }
    $gitCommit = (& git @gitProbeArgs).Trim()
    $toolVersions = [ordered]@{
        rustc = & rustc @rustcProbeArgs
        cargo = & cargo @cargoProbeArgs
        node = & node @nodeProbeArgs
        pnpm = & pnpm @pnpmProbeArgs
        powershell = $PSVersionTable.PSVersion.ToString()
    }
    $sourceSnapshot = Get-SolidFeatureSourceSnapshot -RepositoryRoot $root
    $sourceSnapshotDescriptor = Get-SolidFeatureSourceSnapshotDescriptor -Snapshot $sourceSnapshot
    $dirtyEntries = @(Get-SolidFeatureSourceStatusEntries -RepositoryRoot $root)
    $dirtyHash = $sourceSnapshot.sha256
    $sourceSnapshotPath = Join-Path $evidenceRoot "source-snapshot.json"
    $sourceSnapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $sourceSnapshotPath -Encoding utf8NoBOM
    if (-not (Test-Json -LiteralPath $sourceSnapshotPath -SchemaFile (Join-Path $root "contracts/solid-feature-candidate/source-snapshot.schema.json"))) {
        throw "Persisted source snapshot failed schema validation."
    }
    [ordered]@{
        schema_version=1; candidate_id=$candidate.candidate_id; candidate_revision=$candidate.revision; manifest_sha256=$manifestHash;
        started_at=[DateTimeOffset]::UtcNow.ToString('o'); git_commit=$gitCommit; dirty_tree_sha256=$dirtyHash; dirty_tree_entries=$dirtyEntries;
        source_snapshot=$sourceSnapshotDescriptor; source_snapshot_path="source-snapshot.json";
        command_ledger_path="commands.json"; qualification_invocation=$qualificationInvocation; qualification_rerun=$qualificationInvocation.rerun;
        runtime_export_invocations=[ordered]@{ native=$nativeEvidenceInvocation; wasm=$wasmEvidenceInvocation };
        preflight_invocations=@($candidateStructuralInvocation, $candidateArtifactReadyInvocation);
        validation_invocations=@($completenessPreflightInvocation, $qualificationReadyInvocation);
        identity_probe_invocations=$identityProbeInvocations;
        environment=$environment; tools=$toolVersions
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $evidenceRoot "run-metadata.json") -Encoding utf8NoBOM

    Invoke-Step -Id "candidate-contracts" -Label "Validate candidate contracts and negative self-tests" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @("-NoProfile", "-File", "contracts/solid-feature-candidate/test/manifest-validation.tests.ps1") -SourceId "qualification:candidate-contracts")
    ) -Command { & pwsh -NoProfile -File contracts/solid-feature-candidate/test/manifest-validation.tests.ps1 }
    Invoke-Step -Id "command-provenance-self-test" -Label "Validate content-bound command provenance and replay" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @("-NoProfile", "-File", "scripts/test-solid-feature-command-provenance.ps1") -SourceId "qualification:command-provenance-self-test")
    ) -Command { & pwsh -NoProfile -File scripts/test-solid-feature-command-provenance.ps1 }
    Invoke-Step -Id "source-snapshot-self-test" -Label "Validate content-addressed source snapshot integrity" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @("-NoProfile", "-File", "scripts/test-solid-feature-source-snapshot.ps1") -SourceId "qualification:source-snapshot-self-test")
    ) -Command { & pwsh -NoProfile -File scripts/test-solid-feature-source-snapshot.ps1 }
    Invoke-Step -Id "dependency-pins" -Label "Verify locked Monstertruck dependencies" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @("-NoProfile", "-File", "scripts/test-monstertruck-dependency.ps1") -SourceId "qualification:dependency-pins")
    ) -Command { & pwsh -NoProfile -File scripts/test-monstertruck-dependency.ps1 }
    Invoke-Step -Id "native-workspace" -Label "Run locked native workspace contracts" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "cargo" -Argv @("test", "--workspace", "--locked") -SourceId "qualification:native-workspace")
    ) -Command { cargo test --workspace --locked }
    Invoke-Step -Id "native-planar-face-contracts" -Label "Run focused planar-face authority contracts" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "cargo" -Argv @("test", "-p", "crawler-part-runtime", "--locked", "planar_face") -SourceId "qualification:native-planar-face-contracts")
    ) -Command { cargo test -p crawler-part-runtime --locked planar_face }
    if ($candidate.candidate_id -eq "solid-feature-sprint-5") {
        Invoke-Step -Id "native-single-target-cut-contracts" -Label "Run focused single-target Cut contracts" -Invocations @(
            (New-SolidFeatureCommandInvocation -Executable "cargo" -Argv @("test", "-p", "crawler-part-runtime", "--locked", "single_target_cut") -SourceId "qualification:native-single-target-cut-contracts")
        ) -Command { cargo test -p crawler-part-runtime --locked single_target_cut }
    }
    Invoke-Step -Id "native-lint" -Label "Run locked native lint gate" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "cargo" -Argv @("clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings") -SourceId "qualification:native-lint")
    ) -Command { cargo clippy --workspace --all-targets --locked -- -D warnings }
    foreach ($crate in @("crawler-document", "crawler-feature-kernel", "crawler-versioning", "crawler-feature-graph", "crawler-part-runtime")) {
        Invoke-Step -Id "wasm-$crate" -Label "Compile $crate contracts for wasm32" -Invocations @(
            (New-SolidFeatureCommandInvocation -Executable "cargo" -Argv @("test", "-p", $crate, "--target", "wasm32-unknown-unknown", "--no-run", "--locked") -SourceId "qualification:wasm-$crate")
        ) -Command { cargo test -p $crate --target wasm32-unknown-unknown --no-run --locked }
    }
    Invoke-Step -Id "document-mirror" -Label "Run document protocol mirror" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "node" -Argv @("--experimental-strip-types", "--test", "web/document-protocol/test/*.test.ts") -SourceId "qualification:document-mirror")
    ) -Command { node --experimental-strip-types --test web/document-protocol/test/*.test.ts }
    Invoke-Step -Id "storage-mirror" -Label "Run storage protocol mirror" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "node" -Argv @("--test", "web/storage-protocol/test/*.test.mjs") -SourceId "qualification:storage-mirror")
    ) -Command { node --test web/storage-protocol/test/*.test.mjs }
    Invoke-Step -Id "operation-mirror" -Label "Run operation schema mirror" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "node" -Argv @("--experimental-strip-types", "--test", "web/operation-schema/test/*.test.ts") -SourceId "qualification:operation-mirror")
    ) -Command { node --experimental-strip-types --test web/operation-schema/test/*.test.ts }

    $generatedRoots = @(
        (Join-Path $root "web/worker-spike/generated"),
        (Join-Path $root "web/crawler-app/src/generated/kernel"),
        (Join-Path $root "spikes/e00-s03-renderer/src/generated/packet"),
        (Join-Path $root "web/crawler-app/src/generated/runtime"),
        (Join-Path $root "contracts/operation-schema/catalog.v1.json")
    )
    # Worker-spike and renderer bindings are disposable generator intermediates.
    # Only the app bindings and catalog are synchronized in the repository and
    # therefore required to exist before generation on a clean checkout.
    $synchronizedGeneratedRoots = @(
        (Join-Path $root "web/crawler-app/src/generated/kernel"),
        (Join-Path $root "web/crawler-app/src/generated/runtime"),
        (Join-Path $root "contracts/operation-schema/catalog.v1.json")
    )
    $generatedBefore = @($synchronizedGeneratedRoots | ForEach-Object { if (Test-Path -LiteralPath $_ -PathType Container) { Get-ChildItem -LiteralPath $_ -Recurse -File | ForEach-Object FullName } else { $_ } })
    $checkedInGeneratedHash = Get-FileSetHash $generatedBefore
    $generatorInvocations = @(
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @("-NoProfile", "-File", "scripts/generate-contract-bindings.ps1") -SourceId "qualification:generate-contract-bindings"),
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @("-NoProfile", "-File", "scripts/generate-operation-catalog.ps1") -SourceId "qualification:generate-operation-catalog"),
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv @("-NoProfile", "-File", "scripts/generate-part-runtime.ps1") -SourceId "qualification:generate-part-runtime")
    )
    Invoke-Step -Id "generate-first" -Label "Generate contracts, catalog, and release WASM (pass 1)" -Invocations $generatorInvocations -Command {
        & pwsh -NoProfile -File scripts/generate-contract-bindings.ps1
        & pwsh -NoProfile -File scripts/generate-operation-catalog.ps1
        & pwsh -NoProfile -File scripts/generate-part-runtime.ps1
    }
    $generated = @($generatedRoots | ForEach-Object { if (Test-Path -LiteralPath $_ -PathType Container) { Get-ChildItem -LiteralPath $_ -Recurse -File | ForEach-Object FullName } else { $_ } })
    $firstGeneratedHash = Get-FileSetHash $generated
    Invoke-Step -Id "generate-second" -Label "Generate contracts, catalog, and release WASM (pass 2)" -Invocations $generatorInvocations -Command {
        & pwsh -NoProfile -File scripts/generate-contract-bindings.ps1
        & pwsh -NoProfile -File scripts/generate-operation-catalog.ps1
        & pwsh -NoProfile -File scripts/generate-part-runtime.ps1
    }
    $generatedSecond = @($generatedRoots | ForEach-Object { if (Test-Path -LiteralPath $_ -PathType Container) { Get-ChildItem -LiteralPath $_ -Recurse -File | ForEach-Object FullName } else { $_ } })
    if ((@($generated | Sort-Object) -join "`n") -ne (@($generatedSecond | Sort-Object) -join "`n")) { throw "Generator output file set changed across consecutive runs." }
    $secondGeneratedHash = Get-FileSetHash $generatedSecond
    if ($firstGeneratedHash -ne $secondGeneratedHash) { throw "Generators are not byte-identical across consecutive runs." }
    $synchronizedGeneratedSecond = @($synchronizedGeneratedRoots | ForEach-Object { if (Test-Path -LiteralPath $_ -PathType Container) { Get-ChildItem -LiteralPath $_ -Recurse -File | ForEach-Object FullName } else { $_ } })
    $synchronizedGeneratedSecondHash = Get-FileSetHash $synchronizedGeneratedSecond
    if ((@($generatedBefore | Sort-Object) -join "`n") -ne (@($synchronizedGeneratedSecond | Sort-Object) -join "`n") -or $checkedInGeneratedHash -ne $synchronizedGeneratedSecondHash) {
        throw "Generated artifacts differ from the synchronized worktree output present at qualification start."
    }
    $actualWasmHash = (Get-FileHash -LiteralPath (Join-Path $root "web/crawler-app/src/generated/runtime/crawler_part_runtime_bg.wasm") -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualWasmHash -ne $candidate.runtime_lock.wasm_sha256) { throw "Generated release WASM does not match the candidate lock." }

    Invoke-Step -Id "app-unit" -Label "Run application unit contracts" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "pnpm" -Argv @("--dir", "web/crawler-app", "test:unit") -SourceId "qualification:app-unit")
    ) -Command { pnpm --dir web/crawler-app test:unit }
    Invoke-Step -Id "worker-spike" -Label "Run release-WASM worker contracts" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "node" -Argv @("--test", "web/worker-spike/worker-spike.test.mjs") -SourceId "qualification:worker-spike")
    ) -Command { node --test web/worker-spike/worker-spike.test.mjs }
    if ($candidate.candidate_id -eq "solid-feature-sprint-5") {
        Invoke-Step -Id "wasm-single-target-cut-adapter" -Label "Run release-WASM single-target Cut adapter regression" -Invocations @(
            (New-SolidFeatureCommandInvocation -Executable "node" -Argv @("--test", "--test-name-pattern", "Sprint 5|release-WASM topology", "scripts/test-export-solid-feature-wasm-evidence.mjs") -SourceId "qualification:wasm-single-target-cut-adapter")
        ) -Command { node --test --test-name-pattern "Sprint 5|release-WASM topology" scripts/test-export-solid-feature-wasm-evidence.mjs }
    }
    Invoke-Step -Id "parity-self-tests" -Label "Run parity comparator negative and positive self-tests" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "node" -Argv @("--test", "scripts/test-solid-feature-parity.mjs") -SourceId "qualification:parity-self-tests")
    ) -Command { node --test scripts/test-solid-feature-parity.mjs }
    # Self-tests always run, but only a candidate that owns non-parity fixtures
    # may materialize their fixture evidence into its bundle. This prevents a
    # Sprint 2 run from carrying Sprint 1 fixture records as apparent proof.
    $env:SOLID_FEATURE_NON_PARITY_EVIDENCE_ROOT = if (@($candidate.fixtures | Where-Object { -not $_.parity_required }).Count -gt 0) {
        Join-Path $evidenceRoot "fixtures"
    } else {
        $null
    }
    $env:SOLID_FEATURE_CANDIDATE_MANIFEST = [IO.Path]::GetRelativePath($root, $manifestPath).Replace('\', '/')
    Invoke-Step -Id "non-parity-self-tests" -Label "Run fixture-bound non-parity self-tests" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "node" -Argv @("--test", "scripts/test-solid-feature-non-parity.mjs") -SourceId "qualification:non-parity-self-tests")
    ) -Command { node --test scripts/test-solid-feature-non-parity.mjs }
    Invoke-Step -Id "app-build" -Label "Build the production application" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "pnpm" -Argv @("--dir", "web/crawler-app", "build") -SourceId "qualification:app-build")
    ) -Command { pnpm --dir web/crawler-app build }

    Invoke-Step -Id "native-evidence" -Label "Export canonical native geometry evidence" -Invocations @($nativeEvidenceInvocation) -Command { cargo @nativeEvidenceArgs }
    Invoke-Step -Id "wasm-evidence" -Label "Export canonical release-WASM geometry evidence" -Invocations @($wasmEvidenceInvocation) -Command { node @wasmEvidenceArgs }
    $parityArgs = @(
        "scripts/compare-solid-feature-parity.mjs", "--manifest", $manifestRelative,
        "--native", "artifacts/solid-feature-qualification/current/runtime/native",
        "--wasm", "artifacts/solid-feature-qualification/current/runtime/release-wasm",
        "--output", "artifacts/solid-feature-qualification/current/parity/parity.json",
        "--junit", "artifacts/solid-feature-qualification/current/parity/parity.junit.xml"
    )
    Invoke-Step -Id "native-wasm-parity" -Label "Compare normalized native and release-WASM results" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "node" -Argv $parityArgs -SourceId "qualification:native-wasm-parity")
    ) -Command {
        node @parityArgs
    }

    $browserJunitRaw = Join-Path $evidenceRoot "browser/junit.raw.xml"
    $browserJunitFinal = Join-Path $evidenceRoot "browser/junit.xml"
    $env:SOLID_FEATURE_BROWSER_JUNIT = $browserJunitRaw
    $env:SOLID_FEATURE_BROWSER_OUTPUT = Join-Path $evidenceRoot "browser/results"
    $browserSpecs = @($candidate.tests |
        Where-Object { $_.kind -in @("browser", "performance") -and $_.command -match "playwright\s+test" } |
        ForEach-Object {
            $manifestTest = $_
            $matches = @([regex]::Matches([string]$manifestTest.command, 'tests[/\\][^\s"'']+\.spec\.ts') |
                ForEach-Object { $_.Value.Replace('\', '/') } | Sort-Object -Unique)
            if ($matches.Count -ne 1) { throw "Manifest browser test '$($manifestTest.id)' must name exactly one Playwright spec." }
            $matches[0]
        } | Sort-Object -Unique)
    if ($browserSpecs.Count -eq 0) { throw "Candidate manifest contains no production browser tests." }
    foreach ($testFile in $browserSpecs) {
        if (-not (Test-Path -LiteralPath (Join-Path $root "web/crawler-app/$testFile"))) { throw "Required production browser test is absent: web/crawler-app/$testFile" }
    }
    $browserArgs = @("--dir", "web/crawler-app", "exec", "playwright", "test") + @($browserSpecs) + @("--config", "playwright.solid-feature-qualification.config.ts")
    $finalizeBrowserArgs = @(
        "-NoProfile", "-File", "scripts/finalize-solid-feature-browser-junit.ps1",
        "-Manifest", $manifestRelative,
        "-InputPath", "artifacts/solid-feature-qualification/current/browser/junit.raw.xml",
        "-OutputPath", "artifacts/solid-feature-qualification/current/browser/junit.xml"
    )
    Invoke-Step -Id "production-browser" -Label "Run production-preview solid-feature browser qualification" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "pnpm" -Argv $browserArgs -SourceId "qualification:production-browser"),
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv $finalizeBrowserArgs -SourceId "qualification:finalize-browser-junit")
    ) -Command {
        pnpm --dir web/crawler-app exec playwright test @browserSpecs --config playwright.solid-feature-qualification.config.ts
        if ($LASTEXITCODE -ne 0) { throw "Production Playwright qualification failed with exit code $LASTEXITCODE." }
        & pwsh @finalizeBrowserArgs
        # Keep only the canonical report in a successful evidence bundle. The
        # raw Playwright report carries volatile timing/attachment metadata.
        Remove-Item -LiteralPath $browserJunitRaw -Force
    }

    Copy-Item -LiteralPath (Join-Path $root "contracts/solid-feature-candidate/legacy-solid-feature-matrix.v1.json") -Destination (Join-Path $evidenceRoot "migration/legacy-matrix.json")

    $preflightSourceSnapshot = Get-SolidFeatureSourceSnapshot -RepositoryRoot $root
    Assert-SourceSnapshotUnchanged -Expected $sourceSnapshot -Actual $preflightSourceSnapshot -Phase "preflight"
    [ordered]@{
        schema_version=1; candidate_id=$candidate.candidate_id; candidate_revision=$candidate.revision; manifest_sha256=$manifestHash;
        status="validating"; generated_at=[DateTimeOffset]::UtcNow.ToString('o'); git_commit=$gitCommit; dirty_tree_sha256=$dirtyHash;
        source_snapshot=$sourceSnapshotDescriptor; source_snapshot_path="source-snapshot.json";
        evidence_root="."
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot "qualification-report.json") -Encoding utf8NoBOM
    $preflightChecksums = foreach ($file in Get-ChildItem -LiteralPath $evidenceRoot -Recurse -File | Where-Object Name -ne "SHA256SUMS.json" | Sort-Object FullName) {
        [ordered]@{ path=[IO.Path]::GetRelativePath($evidenceRoot, $file.FullName).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes=$file.Length }
    }
    [ordered]@{ schema_version=1; generated_at=[DateTimeOffset]::UtcNow.ToString('o'); files=@($preflightChecksums) } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot "SHA256SUMS.json") -Encoding utf8NoBOM

    $qualificationIndexArgs = @(
            "-NoProfile", "-File", "scripts/write-solid-feature-qualification-records.ps1",
            "-Manifest", $manifestRelative, "-EvidenceRoot", "artifacts/solid-feature-qualification/current"
    )
    Invoke-Step -Id "qualification-index" -Label "Index passed qualification evidence" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv $qualificationIndexArgs -SourceId "qualification:index-records")
    ) -Command {
        & pwsh @qualificationIndexArgs
    }
    $indexedChecksums = foreach ($file in Get-ChildItem -LiteralPath $evidenceRoot -Recurse -File | Where-Object Name -ne "SHA256SUMS.json" | Sort-Object FullName) {
        [ordered]@{ path=[IO.Path]::GetRelativePath($evidenceRoot, $file.FullName).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes=$file.Length }
    }
    [ordered]@{ schema_version=1; generated_at=[DateTimeOffset]::UtcNow.ToString('o'); files=@($indexedChecksums) } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot "SHA256SUMS.json") -Encoding utf8NoBOM

    & pwsh @completenessPreflightArgs
    if ($LASTEXITCODE -ne 0) { throw "Candidate completeness preflight failed with exit code $LASTEXITCODE." }
    [ordered]@{
        schema_version=1; candidate_id=$candidate.candidate_id; candidate_revision=$candidate.revision; manifest_sha256=$manifestHash;
        subject_kind="test"; subject_id="candidate-evidence-completeness"; status="passed"; recorded_at=[DateTimeOffset]::UtcNow.ToString('o');
        evidence_paths=@("qualification-report.json", "SHA256SUMS.json"); details=[ordered]@{ validator="scripts/test-solid-feature-candidate.ps1" }
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot "records/test.candidate-evidence-completeness.json") -Encoding utf8NoBOM
    & pwsh @qualificationReadyArgs
    if ($LASTEXITCODE -ne 0) { throw "Candidate qualification-ready validation failed with exit code $LASTEXITCODE." }

    $runId = "{0}-{1}-r{2}" -f ([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')), $candidate.candidate_id, $candidate.revision
    $immutablePath = Assert-UnderRoot (Join-Path $immutableRoot $runId)
    $immutableBundleRelative = "artifacts/solid-feature-qualification/runs/$runId"
    $immutableBundleValidationArgs = @(
        "-NoProfile", "-File", "scripts/test-solid-feature-qualification-bundle.ps1", "-BundleRoot", $immutableBundleRelative
    )
    $immutableBundleValidationInvocation = New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv $immutableBundleValidationArgs -SourceId "qualification:post-copy-bundle-integrity"
    $runMetadataPath = Join-Path $evidenceRoot "run-metadata.json"
    $runMetadata = Get-Content -LiteralPath $runMetadataPath -Raw | ConvertFrom-Json -Depth 100
    $runMetadata | Add-Member -NotePropertyName immutable_run_id -NotePropertyValue $runId
    $runMetadata | Add-Member -NotePropertyName post_copy_validation_invocation -NotePropertyValue $immutableBundleValidationInvocation
    $runMetadata | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $runMetadataPath -Encoding utf8NoBOM

    $finalSourceSnapshot = Get-SolidFeatureSourceSnapshot -RepositoryRoot $root
    Assert-SourceSnapshotUnchanged -Expected $sourceSnapshot -Actual $finalSourceSnapshot -Phase "finalization"
    [ordered]@{
        schema_version=1; candidate_id=$candidate.candidate_id; candidate_revision=$candidate.revision; manifest_sha256=$manifestHash;
        status="passed"; generated_at=[DateTimeOffset]::UtcNow.ToString('o'); git_commit=$gitCommit; dirty_tree_sha256=$dirtyHash;
        source_snapshot=$sourceSnapshotDescriptor; source_snapshot_path="source-snapshot.json";
        evidence_root="."; statement="Every candidate story, fixture, test, artifact, and evidence rule passed."
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot "qualification-report.json") -Encoding utf8NoBOM

    $finalChecksums = foreach ($file in Get-ChildItem -LiteralPath $evidenceRoot -Recurse -File | Where-Object Name -ne "SHA256SUMS.json" | Sort-Object FullName) {
        [ordered]@{ path=[IO.Path]::GetRelativePath($evidenceRoot, $file.FullName).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes=$file.Length }
    }
    [ordered]@{ schema_version=1; generated_at=[DateTimeOffset]::UtcNow.ToString('o'); files=@($finalChecksums) } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot "SHA256SUMS.json") -Encoding utf8NoBOM
    $bundleIntegrityArgs = @(
            "-NoProfile", "-File", "scripts/test-solid-feature-qualification-bundle.ps1",
            "-BundleRoot", "artifacts/solid-feature-qualification/current", "-AllowUnchecksummedPath", "logs/bundle-integrity.log"
    )
    Invoke-Step -Id "bundle-integrity" -Label "Validate self-contained bundle links and checksums" -Invocations @(
        (New-SolidFeatureCommandInvocation -Executable "pwsh" -Argv $bundleIntegrityArgs -SourceId "qualification:bundle-integrity")
    ) -Command {
        & pwsh @bundleIntegrityArgs
    }
    # Invoke-Step appends its own log and command record after the validator has
    # checked the provisional bundle. Seal those final files before copying.
    $sealedChecksums = foreach ($file in Get-ChildItem -LiteralPath $evidenceRoot -Recurse -File | Where-Object Name -ne "SHA256SUMS.json" | Sort-Object FullName) {
        [ordered]@{ path=[IO.Path]::GetRelativePath($evidenceRoot, $file.FullName).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes=$file.Length }
    }
    [ordered]@{ schema_version=1; generated_at=[DateTimeOffset]::UtcNow.ToString('o'); files=@($sealedChecksums) } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot "SHA256SUMS.json") -Encoding utf8NoBOM
    if (Test-Path -LiteralPath $immutablePath) { throw "Immutable evidence destination already exists: $immutablePath" }
    New-Item -ItemType Directory -Force (Split-Path -Parent $immutablePath) | Out-Null
    Copy-Item -LiteralPath $evidenceRoot -Destination $immutablePath -Recurse
    & pwsh @immutableBundleValidationArgs
    if ($LASTEXITCODE -ne 0) { throw "The timestamped immutable bundle failed isolated validation." }
    Write-Host "`nSolid-feature qualification passed. Immutable evidence: $immutablePath" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $evidenceRoot) {
        $commandRecords | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $evidenceRoot "commands.json") -Encoding utf8NoBOM
        $checksums = foreach ($file in Get-ChildItem -LiteralPath $evidenceRoot -Recurse -File | Where-Object Name -ne "SHA256SUMS.json" | Sort-Object FullName) {
            [ordered]@{ path=[IO.Path]::GetRelativePath($evidenceRoot, $file.FullName).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes=$file.Length }
        }
        [ordered]@{ schema_version=1; generated_at=[DateTimeOffset]::UtcNow.ToString('o'); files=@($checksums) } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot "SHA256SUMS.json") -Encoding utf8NoBOM
    }
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:SOLID_FEATURE_NON_PARITY_EVIDENCE_ROOT = $previousNonParityEvidenceRoot
    Pop-Location
}
