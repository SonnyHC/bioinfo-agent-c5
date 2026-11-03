$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'core.ps1')
    $target = Join-Path $env:LOCALAPPDATA 'BioInfoBuddy\Launcher'
    $key = 'HKCU:\Software\Classes\bioinfobuddy'
    if (Test-Path $key) {
        $owner = Get-ItemProperty -Path $key -Name 'BioInfoBuddyLauncherPath' -ErrorAction SilentlyContinue
        $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $expected = Get-ProtocolCommand -PowerShellPath $powerShell -ReceiverPath (Join-Path $target 'receive.ps1')
        $registered = (Get-Item -Path ($key + '\shell\open\command')).GetValue('')
        if ($owner -and $owner.BioInfoBuddyLauncherPath -ieq $target -and $registered -ceq $expected) {
            Remove-Item -Path $key -Recurse -Force
        }
    }
    if (Test-Path -LiteralPath $target) {
        if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'The launcher folder is a symbolic link; remove that link manually.'
        }
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    Write-Host 'Launcher removed. Installed analysis environments are kept.' -ForegroundColor Green
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
[void](Read-Host 'Press Enter to close')
