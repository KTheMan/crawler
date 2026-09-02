$script:SolidFeatureSourceSnapshotAlgorithm = "sha256-git-visible-path-content-v1"
$script:SolidFeatureSourceSnapshotExclusions = @("artifacts/solid-feature-qualification/**")

function Invoke-GitText {
    param(
        [Parameter(Mandatory)] [string]$RepositoryRoot,
        [Parameter(Mandatory)] [string[]]$Arguments
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = "git"
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $startInfo.ArgumentList.Add("-C")
    $startInfo.ArgumentList.Add($RepositoryRoot)
    foreach ($argument in $Arguments) { $startInfo.ArgumentList.Add($argument) }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Unable to start git for source snapshot discovery." }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $($process.ExitCode): $stderr"
    }
    return $stdout
}

function Test-SolidFeatureSnapshotExcludedPath {
    param([Parameter(Mandatory)] [string]$RelativePath)
    $path = $RelativePath.Replace('\', '/')
    return $path -eq "artifacts/solid-feature-qualification" -or
        $path.StartsWith("artifacts/solid-feature-qualification/", [StringComparison]::Ordinal)
}

function Get-SolidFeatureSnapshotManifestHash {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [object[]]$Entries)

    $ordered = [Collections.Generic.List[object]]::new()
    foreach ($entry in $Entries) { $ordered.Add($entry) }
    $ordered.Sort([Comparison[object]]{
        param($left, $right)
        return [StringComparer]::Ordinal.Compare([string]$left.path, [string]$right.path)
    })
    $incremental = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    $utf8 = [Text.UTF8Encoding]::new($false)
    function Add-SnapshotFrame {
        param([Parameter(Mandatory)] [AllowEmptyString()] [string]$Value)
        $bytes = $utf8.GetBytes($Value)
        $length = $utf8.GetBytes($bytes.Length.ToString("x16", [Globalization.CultureInfo]::InvariantCulture) + ":")
        $incremental.AppendData($length)
        $incremental.AppendData($bytes)
    }
    try {
        Add-SnapshotFrame $script:SolidFeatureSourceSnapshotAlgorithm
        foreach ($entry in $ordered) {
            Add-SnapshotFrame ([string]$entry.kind)
            Add-SnapshotFrame ([string]$entry.path)
            Add-SnapshotFrame ([string]$entry.bytes)
            Add-SnapshotFrame ([string]$entry.sha256)
        }
        return [Convert]::ToHexString($incremental.GetHashAndReset()).ToLowerInvariant()
    }
    finally { $incremental.Dispose() }
}

function Get-SolidFeatureSourceSnapshot {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$RepositoryRoot)

    $root = (Resolve-Path -LiteralPath $RepositoryRoot).Path
    $rawPaths = Invoke-GitText -RepositoryRoot $root -Arguments @(
        "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".",
        ":(exclude,glob)artifacts/solid-feature-qualification/**"
    )
    $unique = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($rawPath in $rawPaths.Split([char]0, [StringSplitOptions]::RemoveEmptyEntries)) {
        $relative = $rawPath.Replace('\', '/')
        if (Test-SolidFeatureSnapshotExcludedPath $relative) { continue }
        if ([IO.Path]::IsPathRooted($relative) -or $relative -eq ".." -or $relative.StartsWith("../", [StringComparison]::Ordinal)) {
            throw "Git returned a source path outside the repository: $relative"
        }
        [void]$unique.Add($relative)
    }
    $paths = [Collections.Generic.List[string]]::new($unique)
    $paths.Sort([StringComparer]::Ordinal)

    $entries = [Collections.Generic.List[object]]::new()
    foreach ($relative in $paths) {
        $full = [IO.Path]::GetFullPath((Join-Path $root $relative.Replace('/', [IO.Path]::DirectorySeparatorChar)))
        $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Source snapshot path escapes repository: $relative"
        }
        if (-not (Test-Path -LiteralPath $full)) {
            $entry = [ordered]@{ kind="deleted"; path=$relative; bytes=0; sha256=$null }
        }
        else {
            $item = Get-Item -LiteralPath $full -Force
            if ($item.PSIsContainer) { throw "Submodules/directories are unsupported source snapshot entries: $relative" }
            if (-not [string]::IsNullOrEmpty([string]$item.LinkType)) { throw "Symbolic links are unsupported source snapshot entries: $relative" }
            $stream = [IO.File]::Open($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            try {
                $sha = [Security.Cryptography.SHA256]::Create()
                try { $digest = $sha.ComputeHash($stream) } finally { $sha.Dispose() }
                $entry = [ordered]@{
                    kind="file"; path=$relative; bytes=$stream.Length;
                    sha256=[Convert]::ToHexString($digest).ToLowerInvariant()
                }
            }
            finally { $stream.Dispose() }
        }
        $entries.Add([pscustomobject]$entry)
    }
    $snapshotHash = Get-SolidFeatureSnapshotManifestHash -Entries @($entries)
    return [pscustomobject][ordered]@{
        schema_version=1
        algorithm=$script:SolidFeatureSourceSnapshotAlgorithm
        sha256=$snapshotHash
        entry_count=$entries.Count
        file_count=@($entries | Where-Object kind -eq "file").Count
        deleted_count=@($entries | Where-Object kind -eq "deleted").Count
        exclusions=@($script:SolidFeatureSourceSnapshotExclusions)
        entries=@($entries)
    }
}

function Get-SolidFeatureSourceStatusEntries {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$RepositoryRoot)
    $root = (Resolve-Path -LiteralPath $RepositoryRoot).Path
    $text = Invoke-GitText -RepositoryRoot $root -Arguments @(
        "status", "--porcelain=v1", "--untracked-files=all", "--", ".",
        ":(exclude,glob)artifacts/solid-feature-qualification/**"
    )
    return @($text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-SolidFeatureSourceSnapshotDescriptor {
    param([Parameter(Mandatory)] [object]$Snapshot)
    return [ordered]@{
        schema_version=[int]$Snapshot.schema_version
        algorithm=[string]$Snapshot.algorithm
        sha256=[string]$Snapshot.sha256
        entry_count=[int]$Snapshot.entry_count
        file_count=[int]$Snapshot.file_count
        deleted_count=[int]$Snapshot.deleted_count
        exclusions=@($Snapshot.exclusions)
    }
}
