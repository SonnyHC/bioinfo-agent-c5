param([string]$CatalogPath = (Join-Path $PSScriptRoot '..\catalog.json'))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'core.ps1')

function Assert-True { param([bool]$Condition, [string]$Message); if (!$Condition) { throw $Message } }
function Assert-Rejected {
    param([scriptblock]$Action, [string]$Message)
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    Assert-True $rejected $Message
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) ('bioinfobuddy-launcher-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    foreach ($id in $script:WindowsEnvironmentIds) {
        Assert-True ((Get-LaunchId ('bioinfobuddy://install/' + $id)) -ceq $id) "Valid URL rejected: $id"
    }
    $badUrls = @(
        'https://install/single-cell-windows', 'BIOINFOBUDDY://install/single-cell-windows',
        'bioinfobuddy://install/single-cell-macos', 'bioinfobuddy://install/unknown',
        'bioinfobuddy://install/single-cell-windows/', 'bioinfobuddy://install//single-cell-windows',
        'bioinfobuddy://install/single-cell-windows?command=calc', 'bioinfobuddy://install/single-cell-windows#x',
        'bioinfobuddy://user@install/single-cell-windows', 'bioinfobuddy://install:80/single-cell-windows',
        'bioinfobuddy://install/%73ingle-cell-windows', 'bioinfobuddy://install/single-cell-windows%0Acalc',
        'bioinfobuddy://install/single-cell-windows" -Command calc', 'bioinfobuddy://install/single-cell-windows&calc',
        'bioinfobuddy://install/../single-cell-windows', 'bioinfobuddy:\\install\single-cell-windows',
        'bioinfobuddy://install/single-cell-windows$(calc)', "bioinfobuddy://install/single-cell-windows`n"
    )
    foreach ($url in $badUrls) { Assert-Rejected { Get-LaunchId $url } "Unsafe URL accepted: $url" }

    $windows = @(Get-Content -LiteralPath $CatalogPath -Raw -Encoding UTF8 | ConvertFrom-Json | Where-Object { $_.platform -ceq 'windows' })
    $localCatalog = Join-Path $temporary 'catalog.json'
    $windows | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $localCatalog -Encoding UTF8
    $catalog = @(Get-EnvironmentCatalog $localCatalog)
    Assert-True ($catalog.Count -eq 4) 'Expected four Windows catalog entries.'
    $prefix = Join-Path $temporary 'user with spaces\environments\sc_r_win'
    $baseEntry = $catalog | Where-Object { $_.id -ceq 'single-cell-windows' }
    $caseEntry = $catalog | Where-Object { $_.id -ceq 'case-single-cell-windows' }
    $create = New-InstallPlan -Entry $baseEntry -Prefix $prefix -Existing $false
    $update = New-InstallPlan -Entry $baseEntry -Prefix $prefix -Existing $true
    Assert-True ($create.Arguments[0] -ceq 'create') 'New environment should use create.'
    Assert-True ($update.Arguments[0] -ceq 'install') 'Existing environment should use install.'
    Assert-True ($create.Arguments[2] -ceq $prefix) 'Prefix with spaces must be a single argument.'
    Assert-True ($create.Arguments -contains '--override-channels') 'Channels should be scoped to each operation.'
    Assert-True (!($create.Arguments -contains '--name')) 'Installer should use managed prefixes.'

    $script:Calls = New-Object 'Collections.Generic.List[object]'
    $script:FailConda = $false
    $script:ObservedR = ''
    $script:ObservedLibrary = ''
    function Invoke-CheckedConda {
        param([string]$Executable, [string[]]$Arguments)
        $script:Calls.Add([pscustomobject]@{Executable = $Executable; Arguments = $Arguments})
        if ($script:FailConda) { throw 'Mock Conda failure' }
        if ($Arguments[0] -ceq 'run') {
            $script:ObservedR = Get-Content -LiteralPath $Arguments[-1] -Raw
            $script:ObservedLibrary = $env:R_LIBS_USER
        }
    }
    Invoke-InstallPlan -Plan $create -CondaExecutable 'fake conda.exe' -WorkDirectory $temporary
    Assert-True ($script:Calls.Count -eq 2) 'Base environment should install and then verify the runtime.'
    $script:Calls.Clear()
    $casePlan = New-InstallPlan -Entry $caseEntry -Prefix $prefix -Existing $true
    Invoke-InstallPlan -Plan $casePlan -CondaExecutable 'fake conda.exe' -WorkDirectory $temporary
    Assert-True ($script:Calls.Count -eq 2) 'R case should install Conda packages and then R dependencies.'
    Assert-True ($script:Calls[1].Arguments[0] -ceq 'run') 'R packages must execute inside the managed environment.'
    Assert-True ($script:Calls[1].Arguments -contains '--vanilla') 'R must ignore user startup profiles.'
    Assert-True ($script:ObservedLibrary -ceq (Join-Path $prefix 'lib\R\library')) 'R dependencies should use the managed library.'
    Assert-True ($script:ObservedR.Contains('stopifnot(all(vapply(')) 'R dependency installation should verify success.'
    Assert-True (!(Test-Path -LiteralPath (Join-Path $temporary 'verify-environment.R'))) 'Temporary R script should be removed.'
    $script:Calls.Clear()
    $script:FailConda = $true
    Assert-Rejected { Invoke-InstallPlan -Plan $casePlan -CondaExecutable 'fake conda.exe' -WorkDirectory $temporary } 'Conda failure should stop installation.'
    Assert-True ($script:Calls.Count -eq 1) 'R dependencies should not run after Conda failure.'
    Assert-Rejected { New-RInstallScript @("Seurat');system('calc');('") } 'R code injection should be rejected.'

    $command = Get-ProtocolCommand -PowerShellPath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ReceiverPath 'C:\Users\Test Name\Launcher\receive.ps1'
    Assert-True ($command.EndsWith(' -File "C:\Users\Test Name\Launcher\receive.ps1" "%1"')) 'Protocol receiver must receive a quoted literal URL.'
    Assert-True (!$command.Contains('cmd.exe')) 'Protocol handler must not use cmd.exe.'
    Assert-True (!$command.Contains(' -Command ')) 'Protocol handler must not interpret URL as PowerShell code.'
    Assert-Rejected { Get-ProtocolCommand -PowerShellPath 'pwsh' -ReceiverPath 'bad"path' } 'Invalid registration paths should be rejected.'
    Assert-True ((ConvertTo-PowerShellLiteral "C:\Users\O'Brien") -ceq "'C:\Users\O''Brien'") 'Activation commands should quote apostrophes.'
    $activation = @(Get-ActivationCommands -CondaBase $temporary -Prefix $prefix)
    Assert-True ($activation[0].StartsWith(". '")) 'Fresh installations need the Conda PowerShell hook.'
    Assert-True ($activation[1] -ceq ('conda activate ' + (ConvertTo-PowerShellLiteral $prefix))) 'Activation should use the managed prefix.'
    $badCatalog = @($windows | ConvertTo-Json -Depth 6 | ConvertFrom-Json)
    $badCatalog[0].condaPackages[0] = 'python;calc'
    $badCatalog | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $localCatalog -Encoding UTF8
    Assert-Rejected { Get-EnvironmentCatalog $localCatalog } 'Injected package specification should be rejected.'
    @($windows[0], $windows[0], $windows[2], $windows[3]) | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $localCatalog -Encoding UTF8
    Assert-Rejected { Get-EnvironmentCatalog $localCatalog } 'Duplicate catalog IDs should be rejected.'
    Write-Host 'Windows launcher tests passed: URL validation, managed paths, command plans, R execution and failure propagation.'
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
