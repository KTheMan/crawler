function ConvertTo-SolidFeatureCommandToken {
    param([Parameter(Mandatory)] [AllowEmptyString()] [string]$Value)

    if ($Value -match '^[A-Za-z0-9_./:=+,-]+$') { return $Value }
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-SolidFeatureCommandRerun {
    param(
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [string[]]$Argv
    )

    return (@((ConvertTo-SolidFeatureCommandToken $Executable)) + @($Argv | ForEach-Object {
        ConvertTo-SolidFeatureCommandToken ([string]$_)
    })) -join ' '
}

function Get-SolidFeatureCommandInvocationHash {
    param(
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [string[]]$Argv,
        [Parameter(Mandatory)] [string]$SourceId,
        [string]$WorkingDirectory = "."
    )

    $canonical = [ordered]@{
        executable = $Executable
        argv = @($Argv)
        source_id = $SourceId
        working_directory = $WorkingDirectory
    } | ConvertTo-Json -Compress -Depth 10
    $hash = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($canonical))
    return [Convert]::ToHexString($hash).ToLowerInvariant()
}

function New-SolidFeatureCommandInvocation {
    param(
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [string[]]$Argv,
        [Parameter(Mandatory)] [string]$SourceId,
        [string]$WorkingDirectory = "."
    )

    if ([string]::IsNullOrWhiteSpace($Executable)) { throw "Command executable is required." }
    if ([string]::IsNullOrWhiteSpace($SourceId)) { throw "Command source ID is required." }
    if ($WorkingDirectory -ne ".") { throw "Qualification commands must use the repository root as working directory." }
    $arguments = @($Argv | ForEach-Object { [string]$_ })
    return [ordered]@{
        schema_version = 1
        executable = $Executable
        argv = $arguments
        source_id = $SourceId
        working_directory = $WorkingDirectory
        rerun = Get-SolidFeatureCommandRerun -Executable $Executable -Argv $arguments
        invocation_sha256 = Get-SolidFeatureCommandInvocationHash -Executable $Executable -Argv $arguments -SourceId $SourceId -WorkingDirectory $WorkingDirectory
    }
}

function Assert-SolidFeatureCommandInvocation {
    param([Parameter(Mandatory)] [object]$Invocation)

    if ([int]$Invocation.schema_version -ne 1) { throw "Command invocation schema version must be 1." }
    $executable = [string]$Invocation.executable
    $sourceId = [string]$Invocation.source_id
    $workingDirectory = [string]$Invocation.working_directory
    if ([string]::IsNullOrWhiteSpace($executable)) { throw "Command invocation executable is required." }
    if ([string]::IsNullOrWhiteSpace($sourceId)) { throw "Command invocation source ID is required." }
    if ($workingDirectory -ne ".") { throw "Command invocation working directory must be the repository root (.)." }
    if ($null -eq $Invocation.argv -or $Invocation.argv -is [string]) { throw "Command invocation argv must be an array." }
    $arguments = @($Invocation.argv | ForEach-Object { [string]$_ })
    $expectedRerun = Get-SolidFeatureCommandRerun -Executable $executable -Argv $arguments
    if ([string]$Invocation.rerun -cne $expectedRerun) { throw "Command invocation rerun is not derived from executable and argv." }
    $expectedHash = Get-SolidFeatureCommandInvocationHash -Executable $executable -Argv $arguments -SourceId $sourceId -WorkingDirectory $workingDirectory
    if ([string]$Invocation.invocation_sha256 -cne $expectedHash) { throw "Command invocation hash does not bind executable, argv, source ID, and working directory." }
    return $true
}
