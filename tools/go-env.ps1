# Shared local CGO environment; uses the toolchain prepared by the builder.
$cache = Join-Path $env:LOCALAPPDATA 'OpenRadar-Deox\build-cache'
$mingwBin = Join-Path $cache 'msys64\mingw64\bin'
$sdk = Join-Path $cache 'npcap-sdk-1.16'
$gcc = Join-Path $mingwBin 'gcc.exe'
if (-not (Test-Path -LiteralPath $gcc) -or -not (Test-Path -LiteralPath (Join-Path $sdk 'Include\pcap.h'))) {
    throw 'No se encuentra MinGW/Npcap SDK en el cache. Ejecuta primero COMPILAR-PORTABLE.bat para preparar el entorno.'
}
$env:PATH = $mingwBin + ';' + (Join-Path $cache 'msys64\usr\bin') + ';' + $env:PATH
$env:GOTOOLCHAIN = 'local'
$env:CGO_ENABLED = '1'
$env:CC = $gcc
$includePath = (Join-Path $sdk 'Include').Replace('\', '/')
$libPath = (Join-Path $sdk 'Lib\x64').Replace('\', '/')
$env:CGO_CFLAGS = '"-I' + $includePath + '"'
$env:CGO_LDFLAGS = '"-L' + $libPath + '"'
