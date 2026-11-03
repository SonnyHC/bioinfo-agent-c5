Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:WindowsEnvironmentIds = @(
    'single-cell-windows', 'spatial-windows',
    'case-single-cell-windows', 'case-spatial-windows'
)

function Get-LaunchId {
    param([string]$Url)
    # Match the original string; never decode/normalize a command supplied by a URL.
    if ($Url -cnotmatch '\Abioinfobuddy://install/([a-z-]+)\z') {
        throw 'Invalid BioInfoBuddy installation link.'
    }
    $id = $Matches[1]
    if ($script:WindowsEnvironmentIds -cnotcontains $id) {
        throw 'Choose a Windows environment on the website.'
    }
    return $id
}

function Get-EnvironmentCatalog {
    param([string]$Path)
    $entries = @(Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    $seen = @{}
    foreach ($entry in $entries) {
        if ($entry.platform -cne 'windows' -or $script:WindowsEnvironmentIds -cnotcontains $entry.id -or $seen.ContainsKey($entry.id)) {
            throw 'Invalid launcher catalog.'
        }
        $seen[$entry.id] = $true
        if ($entry.envName -cnotmatch '\A[a-z][a-z0-9_-]+\z' -or @($entry.condaPackages).Count -eq 0) {
            throw 'Invalid environment definition.'
        }
        foreach ($package in $entry.condaPackages) {
            if ($package -cnotmatch '\A[a-z0-9][a-z0-9_.-]*(=[A-Za-z0-9_.+*-]+){0,2}\z') {
                throw 'Invalid Conda package specification.'
            }
        }
        if ($entry.PSObject.Properties.Name -contains 'rPackages') {
            foreach ($package in $entry.rPackages) {
                if ($package -cnotmatch '\A[A-Za-z][A-Za-z0-9.]*\z') { throw 'Invalid R package name.' }
            }
        }
    }
    if ($seen.Count -ne $script:WindowsEnvironmentIds.Count) { throw 'Incomplete launcher catalog.' }
    return $entries
}

function New-InstallPlan {
    param($Entry, [string]$Prefix, [bool]$Existing)
    $operation = if ($Existing) { 'install' } else { 'create' }
    $arguments = @($operation, '--prefix', $Prefix, '--yes', '--override-channels', '--channel', 'conda-forge') + @($Entry.condaPackages)
    $rPackages = @()
    if ($Entry.PSObject.Properties.Name -contains 'rPackages') { $rPackages = @($Entry.rPackages) }
    $runtime = if (@($Entry.condaPackages | Where-Object { $_ -match '^r-base(=|$)' }).Count) { 'R' } else { 'Python' }
    return [pscustomobject]@{ Id = $Entry.id; Prefix = $Prefix; Arguments = $arguments; RPackages = $rPackages; Runtime = $runtime }
}

function New-RInstallScript {
    param([string[]]$Packages)
    foreach ($package in $Packages) {
        if ($package -cnotmatch '\A[A-Za-z][A-Za-z0-9.]*\z') { throw 'Invalid R package name.' }
    }
    $names = ($Packages | ForEach-Object { "'$_'" }) -join ', '
    return @"
packages <- c($names)
managed_library <- Sys.getenv('R_LIBS_USER')
dir.create(managed_library, recursive = TRUE, showWarnings = FALSE)
.libPaths(managed_library)
missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) install.packages(missing, lib = managed_library, repos = 'https://cloud.r-project.org')
stopifnot(all(vapply(packages, requireNamespace, logical(1), quietly = TRUE)))
sessionInfo()
"@
}

function Get-ProtocolCommand {
    param([string]$PowerShellPath, [string]$ReceiverPath)
    foreach ($path in @($PowerShellPath, $ReceiverPath)) {
        if ($path.Contains('"') -or $path.Contains("`r") -or $path.Contains("`n")) { throw 'Invalid installation path.' }
    }
    # ShellExecute starts powershell.exe directly. Everything after -File is data.
    return '"{0}" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "{1}" "%1"' -f $PowerShellPath, $ReceiverPath
}

function ConvertTo-PowerShellLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-ActivationCommands {
    param([string]$CondaBase, [string]$Prefix)
    $hook = Join-Path $CondaBase 'shell\condabin\conda-hook.ps1'
    return @(
        ('. ' + (ConvertTo-PowerShellLiteral $hook)),
        ('conda activate ' + (ConvertTo-PowerShellLiteral $Prefix))
    )
}

function Invoke-CheckedConda {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Conda returned exit code $LASTEXITCODE." }
}

function Find-CondaExecutable {
    param([string]$ManagedRoot)
    $candidates = @()
    if ($env:CONDA_EXE) { $candidates += $env:CONDA_EXE }
    $command = Get-Command conda.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    foreach ($root in @(
        (Join-Path $ManagedRoot 'miniconda3'),
        (Join-Path $env:USERPROFILE 'miniconda3'),
        (Join-Path $env:USERPROFILE 'anaconda3'),
        (Join-Path $env:USERPROFILE 'miniforge3'),
        (Join-Path $env:LOCALAPPDATA 'miniconda3'),
        (Join-Path $env:LOCALAPPDATA 'anaconda3'),
        (Join-Path $env:LOCALAPPDATA 'miniforge3'),
        (Join-Path $env:ProgramData 'miniconda3'),
        (Join-Path $env:ProgramData 'anaconda3')
    )) { $candidates += Join-Path $root 'Scripts\conda.exe' }
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ([IO.Path]::GetFileName($candidate) -ine 'conda.exe' -or !(Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            & $candidate --version | Out-Null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch { continue }
    }
    return $null
}

function Install-ManagedConda {
    param([string]$ManagedRoot)
    # Official fixed release and SHA-256 from https://repo.anaconda.com/miniconda/.
    $url = 'https://repo.anaconda.com/miniconda/Miniconda3-py313_26.9.4-0-Windows-x86_64.exe'
    $sha256 = 'b928c6b4d7157b1ebc493fd16605ad1097a598224abe03cec22256983c0df9e9'
    $destination = Join-Path $ManagedRoot 'miniconda3'
    if (Test-Path -LiteralPath $destination) {
        throw "A partial Miniconda installation exists at $destination. Rename that folder and try again."
    }
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('BioInfoBuddy-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $installer = Join-Path $temporary 'miniconda.exe'
    try {
        Write-Host 'Downloading Miniconda...'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
        if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sha256) {
            throw 'Miniconda download checksum did not match. Please try again.'
        }
        Write-Host 'Installing Miniconda...'
        # https://conda.github.io/constructor/cli-options/ : /D is last and unquoted.
        $arguments = '/S /InstallationType=JustMe /AddToPath=0 /RegisterPython=0 /NoShortcuts=1 /D=' + $destination
        $process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Miniconda installer returned exit code $($process.ExitCode)." }
        $conda = Join-Path $destination 'Scripts\conda.exe'
        if (!(Test-Path -LiteralPath $conda -PathType Leaf)) { throw 'Miniconda installation did not produce conda.exe.' }
        return $conda
    } finally {
        Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-InstallPlan {
    param($Plan, [string]$CondaExecutable, [string]$WorkDirectory)
    Invoke-CheckedConda -Executable $CondaExecutable -Arguments $Plan.Arguments
    $savedLibraries = @{}
    $scriptPath = $null
    try {
        if ($Plan.Runtime -ceq 'R') {
            foreach ($key in @('R_LIBS', 'R_LIBS_USER', 'R_LIBS_SITE')) {
                $savedLibraries[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
                [Environment]::SetEnvironmentVariable($key, $null, 'Process')
            }
            # Conda-forge R uses lib/R on Windows as well as on Unix.
            $env:R_LIBS_USER = Join-Path $Plan.Prefix 'lib\R\library'
            $scriptPath = Join-Path $WorkDirectory 'verify-environment.R'
            $source = if ($Plan.RPackages.Count -gt 0) { New-RInstallScript $Plan.RPackages } else { 'sessionInfo()' }
            [IO.File]::WriteAllText($scriptPath, $source, (New-Object Text.UTF8Encoding $false))
            Invoke-CheckedConda -Executable $CondaExecutable -Arguments @('run', '--prefix', $Plan.Prefix, '--no-capture-output', 'Rscript', '--vanilla', $scriptPath)
        } else {
            $scriptPath = Join-Path $WorkDirectory 'verify-environment.py'
            [IO.File]::WriteAllText($scriptPath, "import scanpy, anndata, pandas, numpy`nprint('Scanpy', scanpy.__version__)`n", (New-Object Text.UTF8Encoding $false))
            Invoke-CheckedConda -Executable $CondaExecutable -Arguments @('run', '--prefix', $Plan.Prefix, '--no-capture-output', 'python', '-I', $scriptPath)
        }
    } finally {
        foreach ($key in $savedLibraries.Keys) { [Environment]::SetEnvironmentVariable($key, $savedLibraries[$key], 'Process') }
        if ($scriptPath) { Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue }
    }
}
