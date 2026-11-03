param(
    [Parameter(Mandatory = $true)][string]$Id,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'core.ps1')
$id = Get-LaunchId ('bioinfobuddy://install/' + $Id)
$catalog = Get-EnvironmentCatalog (Join-Path $PSScriptRoot 'catalog.json')
$entry = $catalog | Where-Object { $_.id -ceq $id }

if ($DryRun) {
    New-InstallPlan -Entry $entry -Prefix ('<BioInfoBuddy>/environments/' + $entry.envName) -Existing $false | ConvertTo-Json -Depth 6
    return
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This launcher runs on Windows.' }
$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($architecture -ine 'AMD64') { throw 'This environment is for Windows x86-64 (Intel/AMD).' }

$managedRoot = Join-Path $env:LOCALAPPDATA 'BioInfoBuddy'
$prefix = Join-Path (Join-Path $managedRoot 'environments') $entry.envName
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex = New-Object Threading.Mutex($false, ('Local\BioInfoBuddyEnvironmentInstall-' + $sid))
$locked = $false
$transcribing = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'Another BioInfoBuddy environment installation is running. Wait for it to finish.' }
    $logs = Join-Path $managedRoot 'logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $log = Join-Path $logs ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $id + '.log')
    Start-Transcript -Path $log -Force | Out-Null
    $transcribing = $true
    Write-Host $entry.title
    Write-Host ('Environment: ' + $prefix)
    $conda = Find-CondaExecutable $managedRoot
    if (!$conda) { $conda = Install-ManagedConda $managedRoot }
    $existing = Test-Path -LiteralPath (Join-Path $prefix 'conda-meta\history') -PathType Leaf
    $plan = New-InstallPlan -Entry $entry -Prefix $prefix -Existing $existing
    Invoke-InstallPlan -Plan $plan -CondaExecutable $conda -WorkDirectory $logs
    $condaBase = (Invoke-CheckedConda -Executable $conda -Arguments @('info', '--base') | Select-Object -Last 1).Trim()
    Write-Host ''
    Write-Host 'Installation complete.' -ForegroundColor Green
    Write-Host 'To use this environment, run these two lines in PowerShell:'
    foreach ($line in (Get-ActivationCommands -CondaBase $condaBase -Prefix $prefix)) { Write-Host $line }
    Write-Host ('Log: ' + $log)
} catch {
    Write-Host ('Installation failed: ' + $_.Exception.Message) -ForegroundColor Red
    throw
} finally {
    if ($transcribing) { Stop-Transcript | Out-Null }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
