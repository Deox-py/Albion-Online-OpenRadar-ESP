param(
    [switch]$NoInstall,
    [switch]$SkipQA,
    [switch]$Clean,
    [string]$OutputDirectory = '',
    [string]$CertificateThumbprint = '',
    [string]$SignToolPath = '',
    [string]$TimestampUrl = '',
    [ValidateSet('CurrentUser', 'LocalMachine')][string]$CertificateStoreLocation = 'CurrentUser'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
. (Join-Path $Root 'tools/windows-build/release.ps1')
$InitialPath = $env:Path

$releaseRevision = (Get-Content -LiteralPath (Join-Path $Root 'AUTOBUILD-VERSION.txt') -Raw).Trim() -replace '^V', ''
if ($releaseRevision -notmatch '^\d+\.\d+\.\d+$') { throw 'AUTOBUILD-VERSION.txt debe contener una revision como V7.2.1.' }
$Version = '2.3ESP_Deox-V' + $releaseRevision
$NpcapSdkVersion = '1.16'
$BuildDir = Join-Path $Root '.build'
$SharedCacheRoot = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA 'OpenRadar-Deox\build-cache'
} else {
    Join-Path $BuildDir 'shared-cache'
}
$DownloadCacheDir = Join-Path $SharedCacheRoot 'downloads'
$NpmCacheDir = Join-Path $SharedCacheRoot 'npm-cache'
$MsysCacheRoot = Join-Path $SharedCacheRoot 'msys64'
$NpcapDir = Join-Path $SharedCacheRoot "npcap-sdk-$NpcapSdkVersion"
$FrontendStamp = Join-Path $BuildDir 'frontend-lock.sha256'
$GoStamp = Join-Path $SharedCacheRoot 'go-modules.sha256'
$DistDir = Resolve-ReleaseOutputDirectory -Root $Root -OutputDirectory $OutputDirectory
$LogDir = Join-Path $Root 'build-logs'
New-Item -ItemType Directory -Force -Path $BuildDir, $DistDir, $LogDir, $SharedCacheRoot, $DownloadCacheDir, $NpmCacheDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogFile = Join-Path $LogDir "build-$stamp.log"
Start-Transcript -Path $LogFile -Force | Out-Null

function Banner([string]$Text) {
    Write-Host ''
    Write-Host ('=' * 68) -ForegroundColor DarkCyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ('=' * 68) -ForegroundColor DarkCyan
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $extra = @(
        "$env:ProgramFiles\Go\bin",
        "$env:ProgramFiles\nodejs",
        'C:\msys64\mingw64\bin',
        'C:\msys64\usr\bin',
        (Join-Path $SharedCacheRoot 'msys64\mingw64\bin'),
        (Join-Path $SharedCacheRoot 'msys64\usr\bin')
    ) -join ';'
    # Keep setup-go/setup-node and explicitly selected local tools ahead of
    # older machine-wide installations. MinGW is added separately below.
    $env:Path = "$InitialPath;$machine;$user;$extra"
}

function Get-CommandPath([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Require-Winget {
    if (-not (Get-CommandPath 'winget.exe')) {
        throw @"
No se encontro winget.

Esta dependencia necesita instalarse globalmente. En este equipo Go y Node
ya estaban disponibles, por lo que winget NO es necesario para MSYS2/MinGW:
esa parte se descarga ahora de forma portable desde repo.msys2.org.

Si este mensaje aparece por Go o Node, instalalos manualmente y vuelve a ejecutar.
"@
    }
}

function Install-WingetPackage([string]$Id, [string]$FriendlyName) {
    if ($NoInstall) {
        throw "$FriendlyName no esta disponible y se uso -NoInstall."
    }
    Require-Winget
    Write-Host "Instalando/actualizando $FriendlyName..." -ForegroundColor Yellow
    & winget.exe install --id $Id -e `
        --accept-package-agreements `
        --accept-source-agreements `
        --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        # winget may return non-zero if already installed/newer; retry upgrade is harmless.
        Write-Host "winget install devolvio $LASTEXITCODE; comprobando upgrade..." -ForegroundColor DarkYellow
        & winget.exe upgrade --id $Id -e `
            --accept-package-agreements `
            --accept-source-agreements `
            --disable-interactivity
    }
    Refresh-Path
}

function Ensure-Go {
    Refresh-Path
    $go = Get-CommandPath 'go.exe'
    $ok = $false
    if ($go) {
        $v = (& $go version) -join ' '
        if ($v -match 'go(\d+)\.(\d+)') {
            $maj = [int]$Matches[1]
            $min = [int]$Matches[2]
            $ok = ($maj -gt 1) -or ($maj -eq 1 -and $min -ge 27)
        }
    }
    if (-not $ok) {
        Install-WingetPackage 'GoLang.Go' 'Go 1.27+'
        $go = Get-CommandPath 'go.exe'
    }
    if (-not $go) { throw 'No pude encontrar Go despues de la instalacion.' }

    $v = (& $go version) -join ' '
    if ($v -notmatch 'go(\d+)\.(\d+)' -or
        [int]$Matches[1] -lt 1 -or
        ([int]$Matches[1] -eq 1 -and [int]$Matches[2] -lt 27)) {
        throw "Go 1.27+ requerido. Detectado: $v"
    }
    Write-Host "Go OK: $v" -ForegroundColor Green
}

function Ensure-Node {
    Refresh-Path
    $node = Get-CommandPath 'node.exe'
    $ok = $false
    if ($node) {
        $v = (& $node --version).Trim()
        if ($v -match 'v(\d+)') { $ok = [int]$Matches[1] -ge 24 }
    }
    if (-not $ok) {
        Install-WingetPackage 'OpenJS.NodeJS.LTS' 'Node.js 24+ LTS'
        $node = Get-CommandPath 'node.exe'
    }
    if (-not $node) { throw 'No pude encontrar Node.js despues de la instalacion.' }

    $v = (& $node --version).Trim()
    if ($v -notmatch 'v(\d+)' -or [int]$Matches[1] -lt 24) {
        throw "Node.js 24+ requerido. Detectado: $v"
    }
    Write-Host "Node OK: $v" -ForegroundColor Green
}


function Get-CombinedFileHash([string[]]$Paths) {
    $parts = @()
    foreach ($path in $Paths) {
        if (-not (Test-Path $path)) { continue }
        $parts += (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLowerInvariant()
    }
    if ($parts.Count -eq 0) { return '' }

    $joined = [string]::Join('|', $parts)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($joined)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Test-Executable([string]$Path, [string[]]$Args = @('--version')) {
    if (-not (Test-Path $Path)) { return $false }
    try {
        & $Path @Args *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}


function Add-MingwPath([string]$MsysRoot) {
    $mingwBin = Join-Path $MsysRoot 'mingw64\bin'
    $usrBin = Join-Path $MsysRoot 'usr\bin'

    # Duplicate PATH entries are harmless, but avoiding them keeps logs/debugging readable.
    foreach ($part in @($usrBin, $mingwBin)) {
        $escaped = [regex]::Escape($part)
        if ($env:Path -notmatch "(^|;)$escaped(;|$)") {
            $env:Path = "$part;$env:Path"
        }
    }
}

function Test-MingwCompiler([string]$MsysRoot, [string]$GccPath) {
    if (-not (Test-Path $GccPath)) { return $false }

    # GCC launched by Go/CGO is a native Windows process. Make the MinGW runtime
    # DLLs and helper binaries visible before probing it (not after the probe).
    Add-MingwPath $MsysRoot

    try {
        $versionOutput = (Invoke-CheckedNative -FilePath $GccPath -Arguments @('--version') -Step 'gcc --version' | Out-String).Trim()

        # A --version check alone can pass while cc1/as/ld is broken. Compile and
        # link a tiny C program so the probe matches what CGO will need later.
        $probeDir = Join-Path $BuildDir 'gcc-probe'
        New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
        $probeC = Join-Path $probeDir 'probe.c'
        $probeExe = Join-Path $probeDir 'probe.exe'
        Set-Content -Path $probeC -Value 'int main(void){return 0;}' -Encoding ASCII
        if (Test-Path $probeExe) { Remove-Item $probeExe -Force }

        $compileOutput = (Invoke-CheckedNative -FilePath $GccPath -Arguments @($probeC, '-o', $probeExe) -Step 'prueba real GCC' | Out-String).Trim()
        $ok = Test-Path $probeExe
        if (-not $ok) {
            Write-Host "Prueba real de GCC fallo (codigo $LASTEXITCODE)." -ForegroundColor DarkYellow
            if ($compileOutput) { Write-Host $compileOutput -ForegroundColor DarkGray }
            return $false
        }

        Remove-Item $probeC, $probeExe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        Write-Host "Error al ejecutar GCC: $($_.Exception.Message)" -ForegroundColor DarkYellow
        return $false
    }
}

function Reset-BuildCache {
    Banner 'Limpieza solicitada (-Clean)'
    Write-Host 'Eliminando dependencias locales y cache compartido de OpenRadar...' -ForegroundColor Yellow
    @(
        (Join-Path $Root 'node_modules'),
        (Join-Path $BuildDir 'portable-core'),
        $FrontendStamp,
        $SharedCacheRoot
    ) | ForEach-Object {
        if ($_ -eq $SharedCacheRoot) {
            Remove-BuildPath -Path $_ -AllowedRoot (Split-Path -Parent $SharedCacheRoot)
        } else {
            Remove-BuildPath -Path $_ -AllowedRoot $Root
        }
    }
    # No borramos $BuildDir completo porque el transcript activo vive en build-logs/.
    New-Item -ItemType Directory -Force -Path $BuildDir, $SharedCacheRoot, $DownloadCacheDir, $NpmCacheDir | Out-Null
}

function Ensure-FrontendDependencies([string]$NpmPath) {
    $lockFile = Join-Path $Root 'package-lock.json'
    $nodeModules = Join-Path $Root 'node_modules'
    $vitestCmd = Join-Path $nodeModules '.bin\vitest.cmd'
    $lockHash = Get-CombinedFileHash -Paths @($lockFile)
    $cachedHash = if (Test-Path $FrontendStamp) { (Get-Content $FrontendStamp -Raw).Trim() } else { '' }

    $requiredBins = @('vitest.cmd', 'eslint.cmd', 'tsc.cmd', 'tailwindcss.cmd', 'cpy.cmd') | ForEach-Object {
        Join-Path $nodeModules ('.bin\' + $_)
    }
    $missingBins = @($requiredBins | Where-Object { -not (Test-Path $_) })
    $depsHealthy = (Test-Path $nodeModules) -and ($missingBins.Count -eq 0)

    if ($depsHealthy -and $lockHash -and ($cachedHash -eq $lockHash)) {
        Write-Host 'Dependencias frontend OK: package-lock.json sin cambios; reutilizando node_modules.' -ForegroundColor Green
        return
    }

    Run-Step 'Instalando/actualizando dependencias frontend (npm ci)' {
        & $NpmPath ci --prefer-offline --no-audit --fund=false
    }
    if ($lockHash) { Set-Content -Path $FrontendStamp -Value $lockHash -Encoding ASCII }
}

function Ensure-GoModules([string]$GoPath) {
    $goHash = Get-CombinedFileHash -Paths @((Join-Path $Root 'go.mod'), (Join-Path $Root 'go.sum'))
    $cachedHash = if (Test-Path $GoStamp) { (Get-Content $GoStamp -Raw).Trim() } else { '' }

    if ($goHash -and ($cachedHash -eq $goHash)) {
        Write-Host 'Modulos Go OK: go.mod/go.sum sin cambios; reutilizando cache de Go.' -ForegroundColor Green
        return
    }

    Run-Step 'Verificando/descargando modulos Go' {
        & $GoPath mod download
    }
    if ($goHash) { Set-Content -Path $GoStamp -Value $goHash -Encoding ASCII }
}

function Ensure-Mingw {
    Refresh-Path

    # 1) Existing system MSYS2/MinGW installation.
    $systemMsysRoot = 'C:\msys64'
    $systemGcc = Join-Path $systemMsysRoot 'mingw64\bin\gcc.exe'
    if ((Test-Path $systemGcc) -and (Test-MingwCompiler $systemMsysRoot $systemGcc)) {
        Write-Host "MinGW-w64 OK: $systemGcc" -ForegroundColor Green
        return $systemGcc
    }

    # 2) Shared portable MSYS2 cache. It survives extracted OpenRadar versions,
    #    so V7.1.1/V8 can reuse the same verified toolchain without redownloading it.
    $localMsysRoot = $MsysCacheRoot
    $localBash = Join-Path $localMsysRoot 'usr\bin\bash.exe'
    $localGcc = Join-Path $localMsysRoot 'mingw64\bin\gcc.exe'

    # IMPORTANT: expose the MinGW DLL/runtime directories BEFORE the probe.
    Add-MingwPath $localMsysRoot
    if ((Test-Path $localGcc) -and (Test-MingwCompiler $localMsysRoot $localGcc)) {
        Write-Host "MinGW-w64 OK (cache): $localGcc" -ForegroundColor Green
        return $localGcc
    }
    if ($NoInstall) { throw 'MinGW-w64 no esta disponible/valido en sistema o cache y se uso -NoInstall.' }

    if (-not (Test-Path $localBash)) {
        Banner 'Preparando MSYS2 portable + MinGW-w64'

        # Pinned official MSYS2 release. Avoid the fragile "latest" alias
        # and verify the checksum published by the matching GitHub release.
        $msysRelease = '2026-09-27'
        $msysStamp = '20260927'
        $msysFile = "msys2-base-x86_64-$msysStamp.sfx.exe"
        $sfx = Join-Path $DownloadCacheDir $msysFile

        $githubBase = "https://github.com/msys2/msys2-installer/releases/download/$msysRelease"
        $url = "$githubBase/$msysFile"
        $shaUrl = "$url.sha256"

        if (-not (Test-Path $sfx)) {
            Write-Host 'Descargando MSYS2 desde la release oficial...' -ForegroundColor Yellow
            Write-Host $url -ForegroundColor DarkGray
            Invoke-WebRequest -Uri $url -OutFile $sfx -UseBasicParsing
        } else {
            Write-Host "MSYS2 ya esta en cache: $sfx" -ForegroundColor Green
        }

        $shaFile = "$sfx.sha256"
        Write-Host 'Verificando SHA-256 publicado por MSYS2...' -ForegroundColor Yellow
        Invoke-WebRequest -Uri $shaUrl -OutFile $shaFile -UseBasicParsing

        $shaText = (Get-Content $shaFile -Raw).Trim()
        $expected = (($shaText -split '\s+')[0]).ToLowerInvariant()
        $actual = (Get-FileHash -Algorithm SHA256 -Path $sfx).Hash.ToLowerInvariant()

        if (-not $expected -or $expected.Length -ne 64) {
            throw "El checksum publicado por MSYS2 no tiene un formato SHA-256 valido: $shaText"
        }
        if ($actual -ne $expected) {
            throw "SHA-256 de MSYS2 no coincide. Esperado=$expected Actual=$actual"
        }
        Write-Host "MSYS2 SHA-256 OK: $actual" -ForegroundColor Green

        Write-Host 'Verificando firma Authenticode de MSYS2...' -ForegroundColor Yellow
        $sig = Get-AuthenticodeSignature -FilePath $sfx
        if ($sig.Status -ne 'Valid') {
            throw "Firma Authenticode de MSYS2 no valida: $($sig.Status)"
        }
        Write-Host "Firma MSYS2 valida: $($sig.SignerCertificate.Subject)" -ForegroundColor Green

        Write-Host "Extrayendo MSYS2 en cache compartido: $SharedCacheRoot ..." -ForegroundColor Yellow
        Remove-BuildPath -Path $MsysCacheRoot -AllowedRoot $SharedCacheRoot
        Invoke-CheckedNative -FilePath $sfx -Arguments @('-y', "-o$SharedCacheRoot") -Step 'Extraccion MSYS2 portable' | Out-Host

        if (-not (Test-Path $localBash)) {
            throw "MSYS2 se extrajo, pero no aparece $localBash"
        }
        Add-MingwPath $localMsysRoot
    }

    Banner 'Instalando/reparando GCC MinGW-w64 dentro de MSYS2 local'
    Write-Host 'Actualizando indices de paquetes...' -ForegroundColor Yellow
    # Keep native progress on the host stream. Ensure-Mingw's success stream
    # must contain only the compiler path consumed by the caller.
    Invoke-CheckedNative -FilePath $localBash -Arguments @('-lc', 'pacman -Sy --noconfirm') -Step 'pacman -Sy' | Out-Host

    Write-Host 'Instalando/verificando GCC, binutils y runtime MinGW-w64...' -ForegroundColor Yellow
    Invoke-CheckedNative -FilePath $localBash -Arguments @('-lc', 'pacman -S --needed --noconfirm mingw-w64-x86_64-gcc mingw-w64-x86_64-binutils mingw-w64-x86_64-gcc-libs') -Step 'Instalacion MinGW-w64' | Out-Host

    Add-MingwPath $localMsysRoot
    if (-not (Test-MingwCompiler $localMsysRoot $localGcc)) {
        # One repair attempt for an interrupted/inconsistent package transaction.
        Write-Host 'GCC sigue sin pasar la prueba; forzando reinstalacion de paquetes del toolchain...' -ForegroundColor DarkYellow
        Invoke-CheckedNative -FilePath $localBash -Arguments @('-lc', 'pacman -S --noconfirm mingw-w64-x86_64-gcc mingw-w64-x86_64-binutils mingw-w64-x86_64-gcc-libs') -Step 'Reparacion MinGW-w64' | Out-Host
        Add-MingwPath $localMsysRoot
    }

    if (-not (Test-MingwCompiler $localMsysRoot $localGcc)) {
        throw "MinGW-w64 esta instalado pero no supera la prueba real de compilacion: $localGcc. Revisa el diagnostico inmediatamente anterior en $LogFile"
    }

    Write-Host "MinGW-w64 OK (portable): $localGcc" -ForegroundColor Green
    return $localGcc
}

function Ensure-NpcapSdk {
    $include = Join-Path $NpcapDir 'Include'
    $lib = Join-Path $NpcapDir 'Lib\x64'
    if ((Test-Path (Join-Path $include 'pcap.h')) -and
        ((Test-Path (Join-Path $lib 'wpcap.lib')) -or (Test-Path (Join-Path $lib 'Wpcap.lib')))) {
        Write-Host "Npcap SDK OK: $NpcapDir" -ForegroundColor Green
        return
    }
    if ($NoInstall) { throw 'Npcap SDK no esta disponible en cache y se uso -NoInstall.' }

    New-Item -ItemType Directory -Force -Path $NpcapDir | Out-Null
    $zip = Join-Path $DownloadCacheDir "npcap-sdk-$NpcapSdkVersion.zip"
    $url = "https://npcap.com/dist/npcap-sdk-$NpcapSdkVersion.zip"

    Banner "Preparando Npcap SDK $NpcapSdkVersion"
    if (-not (Test-Path $zip)) {
        Write-Host 'Descargando Npcap SDK desde la fuente oficial...' -ForegroundColor Yellow
        Write-Host $url -ForegroundColor DarkGray
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    } else {
        Write-Host "Npcap SDK ZIP encontrado en cache: $zip" -ForegroundColor Green
    }

    Remove-BuildPath -Path $NpcapDir -AllowedRoot $SharedCacheRoot
    New-Item -ItemType Directory -Force -Path $NpcapDir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $NpcapDir -Force

    if (-not (Test-Path (Join-Path $NpcapDir 'Include\pcap.h'))) {
        throw 'El Npcap SDK descargado no tiene Include\pcap.h en la ruta esperada.'
    }
    Write-Host "Npcap SDK OK: $NpcapDir" -ForegroundColor Green
}

function Run-Step([string]$Name, [scriptblock]$Command) {
    Banner $Name
    $global:LASTEXITCODE = 0
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name fallo con codigo $LASTEXITCODE."
    }
}

try {
    Banner "OpenRadar $Version - compilador automatico"

    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'Esta build requiere Windows x64.'
    }
    $resolvedSignTool = Resolve-ReleaseSignTool -CertificateThumbprint $CertificateThumbprint -SignToolPath $SignToolPath -TimestampUrl $TimestampUrl

    if ($Clean) { Reset-BuildCache }

    Ensure-Go
    Ensure-Node
    Refresh-Path

    $node = Get-CommandPath 'node.exe'
    $go = Get-CommandPath 'go.exe'
    if (-not $node) { throw 'node.exe no encontrado.' }
    if (-not $go) { throw 'go.exe no encontrado.' }

    # Fail fast before any heavy toolchain/package preparation. These checks only
    # need the source tree + Node/Python/Go already present on the machine.
    if (-not $SkipQA) {
        $python = Get-CommandPath 'python.exe'
        if (-not $python) { $python = Get-CommandPath 'py.exe' }

        if ($python) {
            Run-Step 'QA estatico offline' {
                if ((Split-Path -Leaf $python) -ieq 'py.exe') {
                    & $python -3 tools/qa-static.py
                } else {
                    & $python tools/qa-static.py
                }
            }
        } else {
            Write-Host 'Python no instalado: qa-static.py se omite (no bloqueante).' -ForegroundColor DarkYellow
        }

        Run-Step 'Smoke funcional offline V7.1' {
            & $node tools/qa-v7-smoke.mjs
        }
    }

    $gcc = Ensure-Mingw
    Ensure-NpcapSdk
    Refresh-Path
    Add-MingwPath (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $gcc)))
    $toolBin = Split-Path -Parent $gcc
    $windres = Join-Path $toolBin 'windres.exe'
    $objdump = Join-Path $toolBin 'objdump.exe'
    if (-not (Test-Path -LiteralPath $windres) -or -not (Test-Path -LiteralPath $objdump)) {
        throw 'Faltan windres.exe/objdump.exe en el toolchain MinGW verificado.'
    }

    $npm = Get-CommandPath 'npm.cmd'
    $go = Get-CommandPath 'go.exe'
    if (-not $npm) { throw 'npm.cmd no encontrado.' }
    if (-not $go) { throw 'go.exe no encontrado.' }

    # Avoid the very large Chromium download from Puppeteer. It is not needed
    # for normal OpenRadar build/tests in this package.
    $env:PUPPETEER_SKIP_DOWNLOAD = 'true'
    # Cache npm compartida entre carpetas/versiones para evitar volver a bajar cientos de paquetes.
    $env:npm_config_cache = $NpmCacheDir
    $env:npm_config_prefer_offline = 'true'

    # CGO / Npcap SDK configuration.
    $env:CGO_ENABLED = '1'
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    $env:CC = $gcc
    # Forward slashes survive Go's CGO/race quoted-flag parsing on Windows.
    # gopacket itself specifies -lwpcap; do not inject it into runtime/cgo.
    $sdkFlagsPath = $NpcapDir.Replace('\', '/')
    if ($sdkFlagsPath -match '\s') {
        $env:CGO_CFLAGS = "-I`"$sdkFlagsPath/Include`""
        $env:CGO_LDFLAGS = "-L`"$sdkFlagsPath/Lib/x64`""
    } else {
        $env:CGO_CFLAGS = "-I$sdkFlagsPath/Include"
        $env:CGO_LDFLAGS = "-L$sdkFlagsPath/Lib/x64"
    }

    Ensure-GoModules $go
    Ensure-FrontendDependencies $npm

    if (-not $SkipQA) {
        Run-Step 'Tests frontend' {
            & $npm test
        }

        Run-Step 'TypeScript typecheck' {
            & $npm run typecheck
        }

        Run-Step 'Lint frontend/templates/tools' {
            & $npm run lint
        }

        Run-Step 'Tests Go' {
            & $go test ./...
        }
        Run-Step 'Contratos de packaging y recursos Windows' {
            & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tools/windows-build/test.ps1
        }
    } else {
        Write-Host 'QA omitido por -SkipQA.' -ForegroundColor Yellow
    }

    Run-Step 'Construyendo CSS y vendors' {
        & $npm run build
    }

    Banner 'Compilando nucleo Windows amd64'
    New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

    # Publish only after all checks and requested signatures succeed.
    $releaseStage = Join-Path $BuildDir ('release-' + $stamp + '-' + [guid]::NewGuid().ToString('N'))
    $exe = Join-Path $releaseStage 'OpenRadar-2.3ESP_Deox.exe'
    $coreDir = Join-Path $releaseStage 'direct-core'
    $coreExe = Join-Path $coreDir 'OpenRadar-core.exe'
    $payloadPath = Join-Path $Root 'cmd\launcher\payload.bin'
    New-Item -ItemType Directory -Force -Path $coreDir | Out-Null

    $buildTime = (Get-ReleaseTimestamp).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $ldflags = "-s -w -X main.Version=$Version -X main.BuildTime=$buildTime"
    $manifest = Join-Path $Root 'tools/windows-build/OpenRadar.manifest'
    $coreResource = Join-Path $releaseStage 'core_windows_amd64.syso'
    $launcherResource = Join-Path $releaseStage 'launcher_windows_amd64.syso'
    New-WindowsResource -WindresPath $windres -MetadataPath (Join-Path $Root 'cmd/radar/versioninfo.json') -ManifestPath $manifest -OutputPath $coreResource
    New-WindowsResource -WindresPath $windres -MetadataPath (Join-Path $Root 'cmd/launcher/versioninfo.json') -ManifestPath $manifest -OutputPath $launcherResource

    # Stage 1: real radar core, linked against Npcap/libpcap through CGO.
    $env:CGO_ENABLED = '1'
    $env:CC = $gcc
    Invoke-StagedFile -Source $coreResource -Target (Join-Path $Root 'cmd/radar/resource_windows_amd64.syso') -BackupDirectory $releaseStage -Action {
        Invoke-CheckedNative -FilePath $go -Arguments @('build', '-buildvcs=false', '-trimpath', "-ldflags=$ldflags", '-o', $coreExe, './cmd/radar') -Step 'go build del nucleo' | Out-Host
    }
    if (-not (Test-Path $coreExe)) { throw 'go build del nucleo no creo el EXE esperado.' }

    $coreInfo = Get-Item $coreExe
    if ($coreInfo.Length -lt 10MB) {
        throw "El nucleo mide solo $([math]::Round($coreInfo.Length / 1MB, 2)) MB; los assets embebidos podrian faltar."
    }
    Assert-ReleaseImports -FilePath $coreExe -ObjdumpPath $objdump
    Invoke-ReleaseSigning -FilePath $coreExe -CertificateThumbprint $CertificateThumbprint -SignToolPath $resolvedSignTool -TimestampUrl $TimestampUrl -CertificateStoreLocation $CertificateStoreLocation

    # Stage 2: replace the launcher placeholder with that core, then build a
    # CGO-free bootstrapper. This is the single EXE distributed to users and it
    # can start even on machines where Npcap/wpcap.dll is not installed yet.
    Banner 'Compilando launcher portable + asistente Npcap'
    $env:CGO_ENABLED = '0'
    Remove-Item Env:CC -ErrorAction SilentlyContinue
    Invoke-StagedFile -Source $launcherResource -Target (Join-Path $Root 'cmd/launcher/resource_windows_amd64.syso') -BackupDirectory $releaseStage -Action {
        Invoke-StagedFile -Source $coreExe -Target $payloadPath -BackupDirectory $releaseStage -Action {
            Invoke-CheckedNative -FilePath $go -Arguments @('build', '-buildvcs=false', '-trimpath', "-ldflags=$ldflags", '-o', $exe, './cmd/launcher') -Step 'go build del launcher' | Out-Host
        }
    }
    if (-not (Test-Path $exe)) { throw 'go build del launcher no creo el EXE esperado.' }

    Banner 'Verificando release portable'
    $exeInfo = Get-Item $exe
    if ($exeInfo.Length -le $coreInfo.Length) {
        throw "El EXE final no es mayor que el nucleo; el payload portable podria no haberse embebido."
    }
    Assert-ReleaseImports -FilePath $exe -ObjdumpPath $objdump
    Invoke-ReleaseSigning -FilePath $exe -CertificateThumbprint $CertificateThumbprint -SignToolPath $resolvedSignTool -TimestampUrl $TimestampUrl -CertificateStoreLocation $CertificateStoreLocation
    $versionOutput = (Invoke-CheckedNative -FilePath $exe -Arguments @('--version') -Step 'smoke --version' | Out-String).Trim()
    if ($versionOutput -notmatch [regex]::Escape($Version)) {
        throw "Smoke test --version fallo. Salida: $versionOutput"
    }
    Write-Host "Portable OK: $([math]::Round($exeInfo.Length / 1MB, 1)) MB; $versionOutput" -ForegroundColor Green

    foreach ($binary in @($coreExe, $exe)) {
        $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($binary)
        if ($info.ProductVersion -ne $Version) { throw "Metadata de version no coincide con AUTOBUILD-VERSION.txt: $($info.ProductVersion) / $Version" }
        [xml]$appManifest = [Text.Encoding]::UTF8.GetString((Read-WindowsResource -FilePath $binary -Type 24 -Id 1))
        if ($appManifest.assembly.trustInfo.security.requestedPrivileges.requestedExecutionLevel.level -ne 'asInvoker') { throw 'Manifest de elevacion inesperado.' }
        if ((Read-WindowsResource -FilePath $binary -Type 14 -Id 1).Length -lt 6) { throw 'Falta el icono de la aplicacion.' }
    }
    $signatureStatus = if ($CertificateThumbprint) { 'Authenticode: Valid (certificado del usuario, verificado en este equipo)' } else { 'Authenticode: NotSigned (release sin firma)' }
    $notes = @(
        "OpenRadar $Version"
        "Build UTC: $buildTime"
        $signatureStatus
        'Windows x64; captura pasiva; servidor local por defecto.'
        'V7.3.2: cofres capturados sin nombre de color visibles con un icono neutral.'
        'Clasificacion conservadora de cofres de campamento, avalonianos y pequenos tesoros observados.'
        'La clasificacion exige parametros validos; no inventa entidades o posiciones no observadas.'
        'Esta entrega no contiene automatizacion de movimiento/recoleccion ni envio de entradas al juego.'
        'Las coordenadas de otros jugadores siguen sin un descifrador validado.'
        'Consulta docs/releases/INFORME-V7.3.2-COFRES.md en las fuentes para pruebas y limites.'
        'La captura pasiva no garantiza ausencia de sanciones de Albion.'
        'Portable EXE: incluye asistente para instalar Npcap desde la fuente oficial si falta.'
        'ZIP directo: extraer todos los archivos, instalar Npcap desde https://npcap.com/ y ejecutar OpenRadar-core.exe.'
        'El ZIP ejecuta el nucleo directamente y no extrae ni inicia un EXE secundario.'
        'Npcap y su instalador no se redistribuyen; requieren su propia licencia/instalacion.'
        'La metadata y una firma valida identifican el archivo; no garantizan aceptacion por antivirus o SmartScreen.'
        'No se usan UPX, ofuscacion ni mecanismos de evasion.'
        'Verifica SHA256SUMS.txt contra los archivos descargados; el checksum por si solo no prueba la identidad del editor.'
    )
    $notesPath = Join-Path $releaseStage 'RELEASE.txt'
    [IO.File]::WriteAllLines($notesPath, $notes, [Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath $notesPath -Destination (Join-Path $coreDir 'LEEME.txt')
    Copy-Item -LiteralPath (Join-Path $Root 'LICENSE') -Destination (Join-Path $coreDir 'LICENSE.txt')
    $directFiles = @(Get-ChildItem -LiteralPath $coreDir -File | ForEach-Object { $_.FullName })
    Write-ReleaseChecksums -RootDirectory $coreDir -Paths $directFiles -Destination (Join-Path $coreDir 'SHA256SUMS.txt')
    $zipPath = Join-Path $releaseStage 'OpenRadar-2.3ESP_Deox-direct-windows-amd64.zip'
    New-DeterministicZip -SourceDirectory $coreDir -Destination $zipPath
    $hash = Get-FileHash $exe -Algorithm SHA256
    @(
        "OpenRadar $Version"
        "Build UTC: $buildTime"
        "SHA256: $($hash.Hash)"
        'Archivo: OpenRadar-2.3ESP_Deox.exe'
        $signatureStatus
    ) | Set-Content -Path (Join-Path $releaseStage 'SHA256.txt') -Encoding UTF8
    $deliverables = @($exe, $zipPath, $notesPath, (Join-Path $releaseStage 'SHA256.txt'))
    Write-ReleaseChecksums -RootDirectory $releaseStage -Paths $deliverables -Destination (Join-Path $releaseStage 'SHA256SUMS.txt')
    foreach ($deliverable in ($deliverables + (Join-Path $releaseStage 'SHA256SUMS.txt'))) {
        Copy-Item -LiteralPath $deliverable -Destination $DistDir -Force
    }
    $exe = Join-Path $DistDir (Split-Path -Leaf $exe)

    Banner 'BUILD COMPLETADA'
    Write-Host "EXE:    $exe" -ForegroundColor Green
    Write-Host "SHA256: $($hash.Hash)" -ForegroundColor Green
    Write-Host "ZIP:    $(Join-Path $DistDir (Split-Path -Leaf $zipPath))" -ForegroundColor Green
    Write-Host $signatureStatus -ForegroundColor Yellow

    Write-Host ''
    Write-Host 'Npcap onboarding: incluido en el EXE final (pregunta y descarga oficial si falta).' -ForegroundColor Green

    Stop-Transcript | Out-Null
    exit 0
}
catch {
    Write-Host ''
    Write-Host 'BUILD FALLIDA' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Write-Host "Log completo: $LogFile" -ForegroundColor Yellow
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}
