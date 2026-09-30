param(
    [switch]$NoInstall,
    [switch]$SkipQA
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$Version = '2.3ESP_Deox'
$NpcapSdkVersion = '1.16'
$BuildDir = Join-Path $Root '.build'
$NpcapDir = Join-Path $BuildDir 'npcap-sdk'
$DistDir = Join-Path $Root 'dist'
$LogDir = Join-Path $Root 'build-logs'
New-Item -ItemType Directory -Force -Path $BuildDir, $DistDir, $LogDir | Out-Null

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
        'C:\msys64\usr\bin'
    ) -join ';'
    $env:Path = "$machine;$user;$extra"
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

function Ensure-Mingw {
    Refresh-Path

    # 1) Existing system MSYS2/MinGW installation.
    $systemGcc = 'C:\msys64\mingw64\bin\gcc.exe'
    if (Test-Path $systemGcc) {
        Write-Host "MinGW-w64 OK: $systemGcc" -ForegroundColor Green
        return $systemGcc
    }

    # 2) Project-local portable MSYS2. This avoids requiring winget,
    #    Administrator rights, or a global MSYS2 installation.
    $localMsysRoot = Join-Path $BuildDir 'msys64'
    $localBash = Join-Path $localMsysRoot 'usr\bin\bash.exe'
    $localGcc = Join-Path $localMsysRoot 'mingw64\bin\gcc.exe'

    if (-not (Test-Path $localBash)) {
        Banner 'Preparando MSYS2 portable + MinGW-w64'

        # Pinned official MSYS2 release. Avoid the fragile "latest" alias
        # and verify the checksum published by the matching GitHub release.
        $msysRelease = '2026-09-27'
        $msysStamp = '20260927'
        $msysFile = "msys2-base-x86_64-$msysStamp.sfx.exe"
        $sfx = Join-Path $BuildDir $msysFile

        $githubBase = "https://github.com/msys2/msys2-installer/releases/download/$msysRelease"
        $url = "$githubBase/$msysFile"
        $shaUrl = "$url.sha256"

        if (-not (Test-Path $sfx)) {
            Write-Host 'Descargando MSYS2 desde la release oficial...' -ForegroundColor Yellow
            Write-Host $url -ForegroundColor DarkGray
            Invoke-WebRequest -Uri $url -OutFile $sfx -UseBasicParsing
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

        Write-Host "Extrayendo MSYS2 de forma local en $BuildDir ..." -ForegroundColor Yellow
        # The official SFX creates an msys64 directory inside the -o destination.
        & $sfx '-y' "-o$BuildDir"
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo extraer MSYS2 portable (codigo $LASTEXITCODE)."
        }

        if (-not (Test-Path $localBash)) {
            throw "MSYS2 se extrajo, pero no aparece $localBash"
        }
    }

    if (-not (Test-Path $localGcc)) {
        Banner 'Instalando GCC MinGW-w64 dentro de MSYS2 local'
        Write-Host 'Actualizando indices de paquetes...' -ForegroundColor Yellow
        & $localBash -lc 'pacman -Sy --noconfirm'
        if ($LASTEXITCODE -ne 0) {
            throw "pacman -Sy fallo con codigo $LASTEXITCODE."
        }

        Write-Host 'Instalando mingw-w64-x86_64-gcc...' -ForegroundColor Yellow
        & $localBash -lc 'pacman -S --needed --noconfirm mingw-w64-x86_64-gcc'
        if ($LASTEXITCODE -ne 0) {
            throw "pacman no pudo instalar mingw-w64-x86_64-gcc (codigo $LASTEXITCODE)."
        }
    }

    if (-not (Test-Path $localGcc)) {
        throw "MinGW-w64 termino de instalarse pero no encuentro $localGcc"
    }

    # Make DLL/bin helpers available to CGO tools for this build process.
    $env:Path = "$(Join-Path $localMsysRoot 'mingw64\bin');$(Join-Path $localMsysRoot 'usr\bin');$env:Path"

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

    New-Item -ItemType Directory -Force -Path $NpcapDir | Out-Null
    $zip = Join-Path $BuildDir "npcap-sdk-$NpcapSdkVersion.zip"
    $url = "https://npcap.com/dist/npcap-sdk-$NpcapSdkVersion.zip"

    Banner "Descargando Npcap SDK $NpcapSdkVersion"
    Write-Host $url
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

    if (Test-Path $NpcapDir) {
        Remove-Item $NpcapDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $NpcapDir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $NpcapDir -Force

    if (-not (Test-Path (Join-Path $NpcapDir 'Include\pcap.h'))) {
        throw 'El Npcap SDK descargado no tiene Include\pcap.h en la ruta esperada.'
    }
    Write-Host "Npcap SDK OK: $NpcapDir" -ForegroundColor Green
}

function Run-Step([string]$Name, [scriptblock]$Command) {
    Banner $Name
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

    Ensure-Go
    Ensure-Node
    $gcc = Ensure-Mingw
    Ensure-NpcapSdk
    Refresh-Path

    $npm = Get-CommandPath 'npm.cmd'
    $go = Get-CommandPath 'go.exe'
    if (-not $npm) { throw 'npm.cmd no encontrado.' }
    if (-not $go) { throw 'go.exe no encontrado.' }

    # Avoid the very large Chromium download from Puppeteer. It is not needed
    # for normal OpenRadar build/tests in this package.
    $env:PUPPETEER_SKIP_DOWNLOAD = 'true'

    # CGO / Npcap SDK configuration.
    $env:CGO_ENABLED = '1'
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    $env:CC = $gcc
    $env:CGO_CFLAGS = "-I`"$($NpcapDir)\Include`""
    $env:CGO_LDFLAGS = "-L`"$($NpcapDir)\Lib\x64`" -lwpcap"

    Run-Step 'Descargando modulos Go' {
        & $go mod download
    }

    Run-Step 'Instalando dependencias frontend (npm ci)' {
        & $npm ci
    }

    if (-not $SkipQA) {
        $python = Get-CommandPath 'python.exe'
        if (-not $python) { $python = Get-CommandPath 'py.exe' }

        if ($python) {
            Run-Step 'QA estatico' {
                if ((Split-Path -Leaf $python) -ieq 'py.exe') {
                    & $python -3 tools/qa-static.py
                } else {
                    & $python tools/qa-static.py
                }
            }
        } else {
            Write-Host 'Python no instalado: qa-static.py se omite (no bloqueante).' -ForegroundColor DarkYellow
        }

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
    } else {
        Write-Host 'QA omitido por -SkipQA.' -ForegroundColor Yellow
    }

    Run-Step 'Construyendo CSS y vendors' {
        & $npm run build
    }

    Banner 'Compilando nucleo Windows amd64'
    New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

    $exe = Join-Path $DistDir 'OpenRadar-2.3ESP_Deox.exe'
    $coreDir = Join-Path $BuildDir 'portable-core'
    $coreExe = Join-Path $coreDir 'OpenRadar-core.exe'
    $payloadPath = Join-Path $Root 'cmd\launcher\payload.bin'
    New-Item -ItemType Directory -Force -Path $coreDir | Out-Null
    if (Test-Path $exe) { Remove-Item $exe -Force }
    if (Test-Path $coreExe) { Remove-Item $coreExe -Force }

    $buildTime = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $ldflags = "-s -w -X main.Version=$Version -X main.BuildTime=$buildTime"

    # Stage 1: real radar core, linked against Npcap/libpcap through CGO.
    $env:CGO_ENABLED = '1'
    $env:CC = $gcc
    & $go build -trimpath -ldflags="$ldflags" -o $coreExe ./cmd/radar
    if ($LASTEXITCODE -ne 0) { throw "go build del nucleo fallo con codigo $LASTEXITCODE." }
    if (-not (Test-Path $coreExe)) { throw 'go build del nucleo no creo el EXE esperado.' }

    $coreInfo = Get-Item $coreExe
    if ($coreInfo.Length -lt 10MB) {
        throw "El nucleo mide solo $([math]::Round($coreInfo.Length / 1MB, 2)) MB; los assets embebidos podrian faltar."
    }

    # Stage 2: replace the launcher placeholder with that core, then build a
    # CGO-free bootstrapper. This is the single EXE distributed to users and it
    # can start even on machines where Npcap/wpcap.dll is not installed yet.
    Copy-Item -LiteralPath $coreExe -Destination $payloadPath -Force

    Banner 'Compilando launcher portable + asistente Npcap'
    $env:CGO_ENABLED = '0'
    Remove-Item Env:CC -ErrorAction SilentlyContinue
    & $go build -trimpath -ldflags="$ldflags" -o $exe ./cmd/launcher
    if ($LASTEXITCODE -ne 0) { throw "go build del launcher fallo con codigo $LASTEXITCODE." }
    if (-not (Test-Path $exe)) { throw 'go build del launcher no creo el EXE esperado.' }

    Banner 'Verificando release portable'
    $exeInfo = Get-Item $exe
    if ($exeInfo.Length -le $coreInfo.Length) {
        throw "El EXE final no es mayor que el nucleo; el payload portable podria no haberse embebido."
    }
    $versionOutput = (& $exe --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch [regex]::Escape($Version)) {
        throw "Smoke test --version fallo. Salida: $versionOutput"
    }
    Write-Host "Portable OK: $([math]::Round($exeInfo.Length / 1MB, 1)) MB; $versionOutput" -ForegroundColor Green

    $hash = Get-FileHash $exe -Algorithm SHA256
    @(
        "OpenRadar $Version"
        "Build UTC: $buildTime"
        "SHA256: $($hash.Hash)"
        "Archivo: $($hash.Path)"
    ) | Set-Content -Path (Join-Path $DistDir 'SHA256.txt') -Encoding UTF8

    Banner 'BUILD COMPLETADA'
    Write-Host "EXE:    $exe" -ForegroundColor Green
    Write-Host "SHA256: $($hash.Hash)" -ForegroundColor Green

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
