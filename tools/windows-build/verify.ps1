[CmdletBinding()]
param(
    [string]$Directory = 'dist',
    [string]$EvidencePath = '',
    [string]$ExpectedProduct = '2.3ESP_Deox-V7.3.2',
    [string]$ExpectedNumeric = '2.3.0.732'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $root 'tools/windows-build/release.ps1')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -TypeDefinition @'
using System;
public static class ReleasePayloadCheck {
    public static int FindExact(byte[] launcher, byte[] core) {
        for (int i = 0; i <= launcher.Length - core.Length; i++) {
            if (launcher[i] != core[0] || launcher[i+1] != core[1] || launcher[i+2] != core[2] || launcher[i+3] != core[3]) continue;
            int j = 4;
            while (j < 64 && launcher[i+j] == core[j]) j++;
            if (j != 64) continue;
            while (j < core.Length && launcher[i+j] == core[j]) j++;
            if (j == core.Length) return i;
        }
        return -1;
    }
}
'@
function Assert-Release([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Hash-Bytes([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Parse-Checksums([string]$Content) {
    $entries = @{}
    foreach ($line in ($Content -split '\r?\n')) {
        if (-not $line.Trim()) { continue }
        Assert-Release ($line -match '^([a-fA-F0-9]{64})  ([^\r\n]+)$') "Malformed checksum line: $line"
        $hash, $name = $Matches[1].ToLowerInvariant(), $Matches[2]
        Assert-Release (-not $entries.ContainsKey($name)) "Duplicate checksum entry: $name"
        Assert-Release ($name -notmatch '[/\\]' -and $name -notin @('.', '..')) "Unexpected checksum path: $name"
        $entries[$name] = $hash
    }
    return $entries
}
function Inspect-Binary([string]$Path, [string]$ExpectedOriginalName, [string]$ExpectedProduct, [string]$ExpectedBuildUTC) {
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
    Assert-Release ($info.FileVersion -eq $ExpectedNumeric) "Wrong file version: $Path"
    Assert-Release ($info.ProductVersion -eq $ExpectedProduct) "Wrong product version: $Path"
    Assert-Release ($info.OriginalFilename -eq $ExpectedOriginalName) "Wrong original filename: $Path"
    Assert-Release (('{0}.{1}.{2}.{3}' -f $info.FileMajorPart,$info.FileMinorPart,$info.FileBuildPart,$info.FilePrivatePart) -eq $ExpectedNumeric) "Wrong numeric file version: $Path"
    Assert-Release (('{0}.{1}.{2}.{3}' -f $info.ProductMajorPart,$info.ProductMinorPart,$info.ProductBuildPart,$info.ProductPrivatePart) -eq $ExpectedNumeric) "Wrong numeric product version: $Path"
    [xml]$manifest = [Text.Encoding]::UTF8.GetString((Read-WindowsResource -FilePath $Path -Type 24 -Id 1))
    $level = $manifest.assembly.trustInfo.security.requestedPrivileges.requestedExecutionLevel.level
    Assert-Release ($level -eq 'asInvoker') "Unexpected execution level: $Path"
    Assert-Release ($manifest.assembly.assemblyIdentity.version -eq $ExpectedNumeric) "Wrong assembly version: $Path"
    $dpi = $manifest.SelectSingleNode("//*[local-name()='dpiAwareness']")
    Assert-Release ($null -ne $dpi -and $dpi.InnerText -eq 'PerMonitorV2, PerMonitor') "Missing native DPI awareness: $Path"
    $iconBytes = (Read-WindowsResource -FilePath $Path -Type 14 -Id 1).Length
    Assert-Release ($iconBytes -ge 6) "Missing icon: $Path"
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    $version = (Invoke-CheckedNative -FilePath $Path -Arguments @('--version') -Step 'release version verification' | Out-String).Trim()
    Assert-Release ($version -eq "OpenRadar v$ExpectedProduct (built: $ExpectedBuildUTC)") "Version smoke differs from release: $version"
    return [ordered]@{
        path = $Path; version_output = $version; file_version = $info.FileVersion
        product_version = $info.ProductVersion; numeric_file_version = $ExpectedNumeric; numeric_product_version = $ExpectedNumeric
        original_filename = $info.OriginalFilename; file_description = $info.FileDescription
        requested_execution_level = $level; assembly_version = [string]$manifest.assembly.assemblyIdentity.version
        dpi_awareness = [string]$dpi.InnerText
        group_icon_bytes = $iconBytes; authenticode_status = [string]$signature.Status
        authenticode_status_message = $signature.StatusMessage
        signer_thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
    }
}
$dist = Resolve-ReleaseOutputDirectory -Root $root -OutputDirectory $Directory
$launcherPath = Join-Path $dist 'OpenRadar-2.3ESP_Deox.exe'
$zipPath = Join-Path $dist 'OpenRadar-2.3ESP_Deox-direct-windows-amd64.zip'
$expectedProduct = $ExpectedProduct
$release = [IO.File]::ReadAllText((Join-Path $dist 'RELEASE.txt'))
Assert-Release ($release -match '(?m)^Build UTC: ([0-9TZ:-]+)\r?$') 'Missing build UTC'
$buildUTC = $Matches[1]
[void][DateTimeOffset]::Parse($buildUTC)
$outer = Parse-Checksums ([IO.File]::ReadAllText((Join-Path $dist 'SHA256SUMS.txt')))
$deliverableNames = @('OpenRadar-2.3ESP_Deox.exe', 'OpenRadar-2.3ESP_Deox-direct-windows-amd64.zip', 'RELEASE.txt', 'SHA256.txt')
Assert-Release ($outer.Count -eq $deliverableNames.Count) 'Unexpected external checksum count'
$deliverables = @()
foreach ($name in $deliverableNames) {
    $path = Join-Path $dist $name
    $item = Get-Item -LiteralPath $path
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Release ($outer[$name] -eq $hash) "External checksum mismatch: $name"
    $deliverables += [ordered]@{name = $name; sha256 = $hash; bytes = $item.Length; last_write_utc = $item.LastWriteTimeUtc.ToString('o')}
}

$legacy = [IO.File]::ReadAllText((Join-Path $dist 'SHA256.txt'))
Assert-Release ($legacy -match '(?m)^SHA256: ([a-fA-F0-9]{64})\r?$') 'Missing legacy checksum'
Assert-Release ($Matches[1].ToLowerInvariant() -eq $outer['OpenRadar-2.3ESP_Deox.exe']) 'Legacy checksum mismatch'
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
$zipEntries = @{}
$zipEvidence = @()
try {
    foreach ($entry in $archive.Entries) {
        Assert-Release (-not $zipEntries.ContainsKey($entry.FullName)) "Duplicate ZIP entry: $($entry.FullName)"
        Assert-Release ($entry.FullName -notmatch '[/\\]') "Unexpected ZIP path: $($entry.FullName)"
        $stream = $entry.Open(); $memory = [IO.MemoryStream]::new()
        try { $stream.CopyTo($memory); $bytes = $memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
        $zipEntries[$entry.FullName] = $bytes
        $zipEvidence += [ordered]@{name = $entry.FullName; bytes = $entry.Length; sha256 = Hash-Bytes $bytes; archive_timestamp = $entry.LastWriteTime.ToString('o')}
    }
} finally { $archive.Dispose() }
Assert-Release ($zipEntries.Count -eq 4) 'Unexpected direct ZIP entry count'
foreach ($name in @('LEEME.txt', 'LICENSE.txt', 'OpenRadar-core.exe', 'SHA256SUMS.txt')) { Assert-Release ($zipEntries.ContainsKey($name)) "Missing ZIP entry: $name" }
$inner = Parse-Checksums ([Text.Encoding]::UTF8.GetString($zipEntries['SHA256SUMS.txt']))
Assert-Release ($inner.Count -eq 3) 'Unexpected inner checksum count'
foreach ($name in @('LEEME.txt', 'LICENSE.txt', 'OpenRadar-core.exe')) { Assert-Release ($inner[$name] -eq (Hash-Bytes $zipEntries[$name])) "Inner checksum mismatch: $name" }
Assert-Release ((Hash-Bytes $zipEntries['LEEME.txt']) -eq (Get-FileHash -LiteralPath (Join-Path $dist 'RELEASE.txt')).Hash.ToLowerInvariant()) 'Direct readme differs from release notes'
Assert-Release ((Hash-Bytes $zipEntries['LICENSE.txt']) -eq (Get-FileHash -LiteralPath (Join-Path $root 'LICENSE')).Hash.ToLowerInvariant()) 'ZIP license differs from source license'
$core = $zipEntries['OpenRadar-core.exe']
$offset = [ReleasePayloadCheck]::FindExact([IO.File]::ReadAllBytes($launcherPath), $core)
Assert-Release ($offset -ge 0) 'Launcher embedded payload differs from ZIP core bytes'
$corePath = Join-Path $root ('.build/qa/verify-core-' + [guid]::NewGuid().ToString('N') + '/OpenRadar-core.exe')
New-Item -ItemType Directory -Path (Split-Path -Parent $corePath) -Force | Out-Null
[IO.File]::WriteAllBytes($corePath, $core)
Assert-Release ((Get-FileHash -LiteralPath $corePath).Hash.ToLowerInvariant() -eq $inner['OpenRadar-core.exe']) 'Extracted core checksum mismatch'
$oldPath = $env:PATH
try {
    $npcapRuntime = Join-Path $env:WINDIR 'System32/Npcap'
    if (Test-Path -LiteralPath $npcapRuntime) { $env:PATH = $npcapRuntime + ';' + $env:PATH }
    $launcherMetadata = Inspect-Binary $launcherPath 'OpenRadar-2.3ESP_Deox.exe' $expectedProduct $buildUTC
    $coreMetadata = Inspect-Binary $corePath 'OpenRadar-core.exe' $expectedProduct $buildUTC
} finally { $env:PATH = $oldPath }
Assert-Release ($launcherMetadata.authenticode_status -eq 'NotSigned' -and $coreMetadata.authenticode_status -eq 'NotSigned') 'Unexpected signature status for unsigned release'
Assert-Release ($release.Contains('Authenticode: NotSigned (release sin firma)') -and $legacy.Contains('Authenticode: NotSigned (release sin firma)')) 'Signing summary differs from actual artifacts'
$result = [ordered]@{
    status = 'passed'; verified_at_utc = [DateTime]::UtcNow.ToString('o'); build_utc = $buildUTC
    product_version = $expectedProduct; verifier_path = $PSCommandPath
    deliverables = $deliverables; external_checksum_manifest = 'SHA256SUMS.txt'; legacy_checksum_verified = $true
    zip_entries = $zipEvidence; inner_checksum_manifest_verified = $true
    core = [ordered]@{bytes = $core.Length; sha256 = $inner['OpenRadar-core.exe']; extracted_path = $corePath; exact_embedded_payload_match = $true; launcher_payload_offset = $offset}
    launcher_metadata = $launcherMetadata; core_metadata = $coreMetadata
    limits = @('Only --version was executed; no game capture or normal launch.', 'Unsigned release; metadata and checksums do not guarantee antivirus or SmartScreen acceptance.', 'ZIP entry timestamps are fixed for reproducible packaging; build_utc comes from release notes and both executables.')
}
$output = if ($EvidencePath) { [IO.Path]::GetFullPath((Join-Path $root $EvidencePath)) } else { Join-Path $root '.build/qa/release-integrity-V7.3.2.json' }
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
[IO.File]::WriteAllText($output, ($result | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-Output ($result | ConvertTo-Json -Depth 8)
