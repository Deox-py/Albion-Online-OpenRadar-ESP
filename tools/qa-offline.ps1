$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'go-env.ps1')
Push-Location $root
try {
    New-Item -ItemType Directory -Force -Path '.build' | Out-Null
    & go build -buildvcs=false -o .build/qa-replay.exe ./tools/replay-radar
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el servidor de replay.' }
    & node tools/qa-offline-browser.mjs
    $result = $LASTEXITCODE
} finally { Pop-Location }
exit $result
