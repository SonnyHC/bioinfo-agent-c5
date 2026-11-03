$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'core.ps1')
    [void](Get-EnvironmentCatalog (Join-Path $PSScriptRoot 'catalog.json'))
    $target = Join-Path $env:LOCALAPPDATA 'BioInfoBuddy\Launcher'
    $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $receiver = Join-Path $target 'receive.ps1'
    $command = Get-ProtocolCommand -PowerShellPath $powerShell -ReceiverPath $receiver
    $key = 'HKCU:\Software\Classes\bioinfobuddy'
    if (Test-Path $key) {
        $owner = Get-ItemProperty -Path $key -Name 'BioInfoBuddyLauncherPath' -ErrorAction SilentlyContinue
        if (!$owner -or $owner.BioInfoBuddyLauncherPath -ine $target) {
            throw 'The bioinfobuddy protocol is registered by another application.'
        }
    }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($name in @('receive.ps1', 'run.ps1', 'core.ps1', 'catalog.json', 'uninstall.ps1', 'uninstall.cmd')) {
        $source = Join-Path $PSScriptRoot $name
        $destination = Join-Path $target $name
        if ([IO.Path]::GetFullPath($source) -ine [IO.Path]::GetFullPath($destination)) {
            Copy-Item -LiteralPath $source -Destination $destination -Force
        }
    }
    New-Item -Path ($key + '\shell\open\command') -Force | Out-Null
    Set-Item -Path $key -Value 'URL:BioInfoBuddy Environment Installer'
    New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name 'BioInfoBuddyLauncherPath' -Value $target -PropertyType String -Force | Out-Null
    Set-Item -Path ($key + '\shell\open\command') -Value $command
    Write-Host 'BioInfoBuddy launcher installed.' -ForegroundColor Green
    Write-Host 'Return to the website and click the environment installation button.'
    Write-Host ('Uninstall launcher: ' + (Join-Path $target 'uninstall.cmd'))
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    [void](Read-Host 'Press Enter to close')
    exit 1
}
[void](Read-Host 'Press Enter to close')
