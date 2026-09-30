$ErrorActionPreference = 'Stop'

Write-Host 'OpenRadar 2.3ESP_Deox - comprobacion de entorno' -ForegroundColor Cyan

function Parse-Major([string]$version) {
    if ($version -match '(\d+)') { return [int]$Matches[1] }
    return 0
}

$goVersionText = (& go version 2>$null)
if (-not $goVersionText) { throw 'No se encontro Go. Instala Go 1.27 o superior.' }
if ($goVersionText -notmatch 'go(\d+)\.(\d+)') { throw "No pude interpretar: $goVersionText" }
$goMajor = [int]$Matches[1]
$goMinor = [int]$Matches[2]
if ($goMajor -lt 1 -or ($goMajor -eq 1 -and $goMinor -lt 27)) {
    throw "Go 1.27+ requerido. Detectado: $goVersionText"
}

$nodeVersion = (& node --version 2>$null)
if (-not $nodeVersion) { throw 'No se encontro Node.js. Instala Node.js 24 o superior.' }
if ((Parse-Major $nodeVersion) -lt 24) { throw "Node.js 24+ requerido. Detectado: $nodeVersion" }

Write-Host "Go:   $goVersionText" -ForegroundColor Green
Write-Host "Node: $nodeVersion" -ForegroundColor Green

Write-Host 'Instalando dependencias frontend...' -ForegroundColor Cyan
npm ci

Write-Host 'Ejecutando QA estatico...' -ForegroundColor Cyan
if (Get-Command python -ErrorAction SilentlyContinue) {
    python tools/qa-static.py
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    py -3 tools/qa-static.py
} else {
    Write-Warning 'Python no encontrado: se omite qa-static.py'
}

Write-Host 'Ejecutando tests frontend...' -ForegroundColor Cyan
npm test

Write-Host 'Ejecutando lint frontend...' -ForegroundColor Cyan
npm run lint

Write-Host 'Ejecutando tests Go...' -ForegroundColor Cyan
go test ./...

Write-Host 'Construyendo assets...' -ForegroundColor Cyan
npm run build

Write-Host 'Compilando Windows amd64...' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path dist | Out-Null
$buildTime = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$ldflags = "-s -w -X main.Version=2.3ESP_Deox -X main.BuildTime=$buildTime"
$env:CGO_ENABLED = '1'
$env:GOOS = 'windows'
$env:GOARCH = 'amd64'
go build -ldflags="$ldflags" -o dist/OpenRadar-2.3ESP_Deox-windows-amd64.exe ./cmd/radar

Write-Host 'Build terminada: dist/OpenRadar-2.3ESP_Deox-windows-amd64.exe' -ForegroundColor Green
Get-FileHash dist/OpenRadar-2.3ESP_Deox-windows-amd64.exe -Algorithm SHA256
