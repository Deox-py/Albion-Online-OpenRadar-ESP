# Shared packaging helpers. Dot-sourcing this file performs no build or install.
function Remove-BuildPath {
    param([string]$Path, [string]$AllowedRoot)
    $target = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw "Ruta de limpieza fuera del directorio autorizado: $target" }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}

function Invoke-CheckedNative {
    param([string]$FilePath, [string[]]$Arguments = @(), [string]$Step = 'Comando')
    # Windows PowerShell turns native stderr into ErrorRecord objects when merged.
    # Inspect the actual native exit code, including tools that warn on stderr.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $FilePath @Arguments 2>&1 | ForEach-Object { $_.ToString() }
        $nativeExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($nativeExit -ne 0) { throw "$Step fallo con codigo $nativeExit." }
}

function Invoke-StagedFile {
    param([string]$Source, [string]$Target, [string]$BackupDirectory, [scriptblock]$Action)
    $existed = Test-Path -LiteralPath $Target
    $backup = Join-Path $BackupDirectory ('staged-' + [guid]::NewGuid().ToString('N') + '.backup')
    if ($existed) { Copy-Item -LiteralPath $Target -Destination $backup -Force }
    try {
        Copy-Item -LiteralPath $Source -Destination $Target -Force
        & $Action
    } finally {
        if ($existed) {
            Copy-Item -LiteralPath $backup -Destination $Target -Force
            Remove-Item -LiteralPath $backup -Force
        } elseif (Test-Path -LiteralPath $Target) {
            Remove-Item -LiteralPath $Target -Force
        }
    }
}

function Get-ReleaseTimestamp {
    if ($env:SOURCE_DATE_EPOCH) {
        $epoch = 0L
        if (-not [long]::TryParse($env:SOURCE_DATE_EPOCH, [ref]$epoch) -or $epoch -lt 0) {
            throw 'SOURCE_DATE_EPOCH debe ser un numero entero de segundos UTC desde 1970.'
        }
        return [DateTimeOffset]::FromUnixTimeSeconds($epoch).UtcDateTime
    }
    return (Get-Date).ToUniversalTime()
}

function New-DeterministicZip {
    param([string]$SourceDirectory, [string]$Destination)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    $root = [IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    # ZIP timestamps are fixed (and even-second) so staging filesystem metadata
    # cannot change archive bytes. Build UTC remains explicit in the release notes.
    $timestamp = [DateTimeOffset]::new(2020, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
    $files = @(Get-ChildItem -LiteralPath $SourceDirectory -File -Recurse | Sort-Object { $_.FullName.Substring($root.Length).Replace('\', '/') })
    $stream = [IO.File]::Open($Destination, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $archive = $null
    try {
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
        foreach ($file in $files) {
            $name = $file.FullName.Substring($root.Length).Replace('\', '/')
            $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $timestamp
            $input = [IO.File]::OpenRead($file.FullName)
            $output = $entry.Open()
            try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
        }
    } finally { if ($archive) { $archive.Dispose() }; $stream.Dispose() }
}

function Write-ReleaseChecksums {
    param([string]$RootDirectory, [string[]]$Paths, [string]$Destination)
    $root = [IO.Path]::GetFullPath($RootDirectory).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $lines = foreach ($path in ($Paths | Sort-Object)) {
        $fullPath = [IO.Path]::GetFullPath($path)
        if (-not $fullPath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
            throw "El archivo del checksum esta fuera de la release: $fullPath"
        }
        $relative = $fullPath.Substring($root.Length).Replace('\', '/')
        (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $relative
    }
    [IO.File]::WriteAllLines($Destination, [string[]]$lines, [Text.UTF8Encoding]::new($false))
}

function Resolve-ReleaseSignTool {
    param([string]$CertificateThumbprint, [string]$SignToolPath, [string]$TimestampUrl)
    if (-not $CertificateThumbprint) {
        if ($SignToolPath -or $TimestampUrl) { throw 'SignToolPath/TimestampUrl requieren CertificateThumbprint; no se genera una release sin firma silenciosamente.' }
        return $null
    }
    $thumbprint = $CertificateThumbprint -replace '\s', ''
    if ($thumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'CertificateThumbprint debe tener 40 digitos hexadecimales.' }
    if ($TimestampUrl -and $TimestampUrl -notmatch '^https://') { throw 'TimestampUrl debe usar HTTPS.' }
    if (-not $SignToolPath) {
        $tool = Get-Command signtool.exe -ErrorAction SilentlyContinue
        if ($tool) { $SignToolPath = $tool.Source }
    }
    if (-not $SignToolPath -or -not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) {
        throw 'Firma solicitada: no se encontro signtool.exe. Indica -SignToolPath con el SDK de Windows ya instalado.'
    }
    return (Resolve-Path -LiteralPath $SignToolPath).Path
}

function Invoke-ReleaseSigning {
    param(
        [string]$FilePath, [string]$CertificateThumbprint, [string]$SignToolPath,
        [string]$TimestampUrl = '', [ValidateSet('CurrentUser', 'LocalMachine')][string]$CertificateStoreLocation = 'CurrentUser'
    )
    $tool = Resolve-ReleaseSignTool -CertificateThumbprint $CertificateThumbprint -SignToolPath $SignToolPath -TimestampUrl $TimestampUrl
    if (-not $tool) { return }
    $thumbprint = ($CertificateThumbprint -replace '\s', '').ToUpperInvariant()
    $arguments = @('sign', '/fd', 'SHA256', '/sha1', $thumbprint, '/s', 'My')
    if ($CertificateStoreLocation -eq 'LocalMachine') { $arguments += '/sm' }
    if ($TimestampUrl) { $arguments += @('/tr', $TimestampUrl, '/td', 'SHA256') }
    $arguments += $FilePath
    Invoke-CheckedNative -FilePath $tool -Arguments $arguments -Step 'firma Authenticode' | Out-Host
    Invoke-CheckedNative -FilePath $tool -Arguments @('verify', '/pa', '/all', '/v', $FilePath) -Step 'verificacion Authenticode' | Out-Host
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $thumbprint) {
        throw "La firma no es valida o no corresponde al certificado solicitado: $($signature.Status)."
    }
    if ($TimestampUrl -and -not $signature.TimeStamperCertificate) { throw 'Se solicito timestamp, pero la firma no tiene un sello de tiempo verificado.' }
}

function Assert-NoBundledRuntimeDependencies {
    param([string[]]$Imports)
    $supported = @('kernel32.dll', 'ntdll.dll', 'user32.dll', 'advapi32.dll', 'ws2_32.dll', 'msvcrt.dll', 'ucrtbase.dll',
        'bcrypt.dll', 'crypt32.dll', 'secur32.dll', 'shell32.dll', 'ole32.dll', 'oleaut32.dll', 'gdi32.dll', 'winmm.dll',
        'shlwapi.dll', 'comdlg32.dll', 'version.dll', 'setupapi.dll', 'normaliz.dll', 'iphlpapi.dll', 'wpcap.dll', 'packet.dll')
    foreach ($name in $Imports) {
        if ($name.ToLowerInvariant() -notin $supported -and $name -notmatch '^(api-ms-win-|ext-ms-win-)') {
            throw "Dependencia runtime no distribuida: $name. Enlaza el runtime estaticamente o prepara una distribucion con sus DLL/licencias."
        }
    }
}

function Assert-ReleaseImports {
    param([string]$FilePath, [string]$ObjdumpPath)
    $output = Invoke-CheckedNative -FilePath $ObjdumpPath -Arguments @('-p', $FilePath) -Step 'auditoria de DLL'
    $imports = @($output | ForEach-Object { if ($_ -match 'DLL Name:\s*(\S+)') { $Matches[1] } })
    if ($imports.Count -eq 0) { throw "No se pudieron leer los imports PE: $FilePath" }
    Assert-NoBundledRuntimeDependencies -Imports $imports
    Write-Host ('DLL imports: ' + ($imports -join ', '))
}

function New-WindowsResource {
    param([string]$WindresPath, [string]$MetadataPath, [string]$ManifestPath, [string]$OutputPath)
    $metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
    $icon = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $MetadataPath) $metadata.IconPath)).Replace('\', '/')
    $manifest = [IO.Path]::GetFullPath($ManifestPath).Replace('\', '/')
    if (-not (Test-Path -LiteralPath $icon)) { throw "Icono no encontrado: $icon" }
    $fileVersion = $metadata.FixedFileInfo.FileVersion
    $productVersion = $metadata.FixedFileInfo.ProductVersion
    $values = foreach ($property in $metadata.StringFileInfo.PSObject.Properties) {
        $escaped = ([string]$property.Value).Replace('\', '\\').Replace('"', '\"')
        '      VALUE "' + $property.Name + '", "' + $escaped + '\0"'
    }
    $rc = @"
1 ICON "$icon"
1 24 "$manifest"
1 VERSIONINFO
 FILEVERSION $($fileVersion.Major),$($fileVersion.Minor),$($fileVersion.Patch),$($fileVersion.Build)
 PRODUCTVERSION $($productVersion.Major),$($productVersion.Minor),$($productVersion.Patch),$($productVersion.Build)
 FILEFLAGSMASK 0x3fL
 FILEFLAGS 0x0L
 FILEOS 0x40004L
 FILETYPE 0x1L
 FILESUBTYPE 0x0L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904b0"
    BEGIN
$($values -join "`n")
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END
"@
    $rcPath = $OutputPath + '.rc'
    [IO.File]::WriteAllText($rcPath, $rc, [Text.UTF8Encoding]::new($false))
    Invoke-CheckedNative -FilePath $WindresPath -Arguments @('--codepage=65001', '-i', $rcPath, '-O', 'coff', '-F', 'pe-x86-64', '-o', $OutputPath) -Step 'recursos Windows' | Out-Host
    if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'windres no genero los recursos esperados.' }
}

function Read-WindowsResource {
    param([string]$FilePath, [int]$Type, [int]$Id)
    if (-not ('OpenRadar.ResourceReader' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace OpenRadar {
    public static class ResourceReader {
        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);
        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
        [DllImport("kernel32", SetLastError = true)] static extern uint SizeofResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32", SetLastError = true)] static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32", SetLastError = true)] static extern IntPtr LockResource(IntPtr resource);
        [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr module);
        public static byte[] Read(string path, int type, int id) {
            IntPtr module = LoadLibraryEx(path, IntPtr.Zero, 2);
            if (module == IntPtr.Zero) throw new Win32Exception();
            try {
                IntPtr resource = FindResource(module, new IntPtr(id), new IntPtr(type));
                if (resource == IntPtr.Zero) throw new Win32Exception();
                int length = checked((int)SizeofResource(module, resource));
                IntPtr pointer = LockResource(LoadResource(module, resource));
                if (pointer == IntPtr.Zero) throw new Win32Exception();
                byte[] data = new byte[length];
                Marshal.Copy(pointer, data, 0, length);
                return data;
            } finally { FreeLibrary(module); }
        }
    }
}
'@
    }
    return ,([OpenRadar.ResourceReader]::Read([IO.Path]::GetFullPath($FilePath), $Type, $Id))
}
function Resolve-ReleaseOutputDirectory {
    param([string]$Root, [string]$OutputDirectory = '')
    $distRoot = [IO.Path]::GetFullPath((Join-Path $Root 'dist')).TrimEnd('\', '/')
    $output = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        $distRoot
    } elseif ([IO.Path]::IsPathRooted($OutputDirectory)) {
        [IO.Path]::GetFullPath($OutputDirectory)
    } else {
        [IO.Path]::GetFullPath((Join-Path $Root $OutputDirectory))
    }
    $output = $output.TrimEnd('\', '/')
    if ($output -ne $distRoot -and -not $output.StartsWith($distRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'La salida de compilación debe estar dentro de dist para preservar la fuente.'
    }
    return $output
}
