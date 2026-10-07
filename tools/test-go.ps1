param(
    [switch]$Race,
    [string[]]$Packages = @('.', './cmd/...', './internal/...', './tools/...'),
    [string[]]$ExtraArgs = @()
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'go-env.ps1')
Push-Location $root
try {
    $goArgs = @('test')
    if ($Race) { $goArgs += '-race' }
    $goArgs += $ExtraArgs
    $goArgs += $Packages
    & go @goArgs
    $result = $LASTEXITCODE
} finally { Pop-Location }
exit $result
