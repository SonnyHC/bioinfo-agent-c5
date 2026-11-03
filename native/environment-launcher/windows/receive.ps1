# No param block: injected extra command-line arguments are rejected as data.
$ErrorActionPreference = 'Stop'
$result = 1
try {
    . (Join-Path $PSScriptRoot 'core.ps1')
    if ($args.Count -ne 1) { throw 'Expected one BioInfoBuddy installation link.' }
    $id = Get-LaunchId ([string]$args[0])
    & (Join-Path $PSScriptRoot 'run.ps1') -Id $id
    $result = 0
} catch {
    Write-Host ('Installation stopped: ' + $_.Exception.Message) -ForegroundColor Red
}
Write-Host ''
[void](Read-Host 'Press Enter to close')
exit $result
