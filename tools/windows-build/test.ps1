$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$helpers = Join-Path $PSScriptRoot 'release.ps1'
if (-not (Test-Path -LiteralPath $helpers)) { throw 'Release helpers are not implemented yet.' }
. $helpers
Add-Type -AssemblyName System.IO.Compression.FileSystem

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('openradar-release-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$count = 0
function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Test([string]$Name, [scriptblock]$Body) {
    & $Body
    $script:count++
    Write-Host "PASS: $Name"
}
try {
    Test 'Builder preserves the toolchain selected by the caller ahead of system tools' {
        $projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
        $parseTokens = $null
        $parseErrors = $null
        $builderAst = [Management.Automation.Language.Parser]::ParseFile(
            (Join-Path $projectRoot 'AUTO-BUILD-2.3ESP_Deox.ps1'), [ref]$parseTokens, [ref]$parseErrors)
        Assert ($parseErrors.Count -eq 0) 'Builder contains invalid PowerShell.'
        $refresh = $builderAst.Find({ param($node)
            $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Refresh-Path'
        }, $true)
        Assert ($null -ne $refresh) 'Builder PATH setup is missing.'
        $preferredBin = Join-Path $testRoot 'selected-toolchain'
        New-Item -ItemType Directory -Path $preferredBin | Out-Null
        $selectedGo = Join-Path $preferredBin 'go.exe'
        [IO.File]::WriteAllBytes($selectedGo, [byte[]]@())
        $InitialPath = $preferredBin
        $SharedCacheRoot = Join-Path $testRoot 'cache'
        $savedPath = $env:Path
        try {
            & $refresh.Body.GetScriptBlock()
            Assert (($env:Path -split ';')[0] -eq $preferredBin) 'Caller toolchain lost PATH precedence.'
            Assert ((Get-Command go.exe).Source -eq $selectedGo) 'An older system Go shadows the selected toolchain.'
        } finally { $env:Path = $savedPath }
    }
    Test 'Fresh portable MinGW returns only its compiler path despite native progress output' {
        $projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
        $parseTokens = $null
        $parseErrors = $null
        $builderAst = [Management.Automation.Language.Parser]::ParseFile(
            (Join-Path $projectRoot 'AUTO-BUILD-2.3ESP_Deox.ps1'), [ref]$parseTokens, [ref]$parseErrors)
        $ensure = $builderAst.Find({ param($node)
            $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Ensure-Mingw'
        }, $true)
        $MsysCacheRoot = Join-Path $testRoot 'fresh-msys64'
        $NoInstall = $false
        $nativeBin = Join-Path $MsysCacheRoot 'usr/bin'
        $compilerBin = Join-Path $MsysCacheRoot 'mingw64/bin'
        New-Item -ItemType Directory -Path $nativeBin, $compilerBin | Out-Null
        $fakeBash = Join-Path $nativeBin 'bash.exe'
        Add-Type -TypeDefinition 'public class NativePackageProgress { public static void Main() { System.Console.WriteLine("package progress"); System.Console.WriteLine(); } }' -OutputAssembly $fakeBash -OutputType ConsoleApplication
        $expectedCompiler = Join-Path $compilerBin 'gcc.exe'
        [IO.File]::WriteAllBytes($expectedCompiler, [byte[]]@())
        function Refresh-Path {}
        function Add-MingwPath([string]$MsysRoot) {}
        function Banner([string]$Text) { Write-Host $Text }
        function Test-Path([string]$Path) {
            if ($Path -eq 'C:\msys64\mingw64\bin\gcc.exe') { return $false }
            Microsoft.PowerShell.Management\Test-Path -LiteralPath $Path
        }
        $script:portableProbeCount = 0
        function Test-MingwCompiler([string]$MsysRoot, [string]$GccPath) {
            $script:portableProbeCount++
            return $script:portableProbeCount -gt 1
        }
        $result = @(& $ensure.Body.GetScriptBlock())
        Assert ($result.Count -eq 1) 'Native progress polluted the compiler path returned to the builder.'
        Assert ($result[0] -eq $expectedCompiler) 'Fresh setup returned the wrong compiler.'
    }
    Test 'Trial output resolves beneath dist and rejects paths outside it' {
        $projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
        $default = Resolve-ReleaseOutputDirectory -Root $projectRoot
        Assert ($default -eq (Join-Path $projectRoot 'dist')) 'Default distribution path changed.'
        $trial = Resolve-ReleaseOutputDirectory -Root $projectRoot -OutputDirectory 'dist/pruebas/V7.3.2'
        Assert ($trial -eq [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist/pruebas/V7.3.2'))) 'Trial output path was not resolved from project root.'
        $absolute = Resolve-ReleaseOutputDirectory -Root $projectRoot -OutputDirectory $trial
        Assert ($absolute -eq $trial) 'Absolute trial path was not accepted.'
        foreach ($outside in @('../outside', 'dist/../source', 'dist-extra/trial', $testRoot)) {
            $rejected = $false
            try { Resolve-ReleaseOutputDirectory -Root $projectRoot -OutputDirectory $outside | Out-Null }
            catch { $rejected = $_.Exception.Message -match 'dist' }
            Assert $rejected "Output outside dist was accepted: $outside"
        }
    }
    Test 'Staging restores original payload after a failed compiler' {
        $target = Join-Path $testRoot 'payload.bin'
        $source = Join-Path $testRoot 'core.exe'
        [IO.File]::WriteAllBytes($target, [byte[]]@(0, 255, 17, 64))
        [IO.File]::WriteAllBytes($source, [byte[]]@(77, 90, 1, 2, 3))
        $before = (Get-FileHash -LiteralPath $target).Hash
        $failed = $false
        try {
            Invoke-StagedFile -Source $source -Target $target -BackupDirectory $testRoot -Action {
                Assert ((Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath $source).Hash) 'Core was not staged.'
                throw 'compiler failed'
            }
        } catch { $failed = $_.Exception.Message -eq 'compiler failed' }
        Assert $failed 'Compiler failure was swallowed.'
        Assert ((Get-FileHash -LiteralPath $target).Hash -eq $before) 'Original payload bytes were not restored.'
    }
    Test 'Staging removes a temporary resource when no original existed' {
        $target = Join-Path $testRoot 'resource.syso'
        Invoke-StagedFile -Source (Join-Path $testRoot 'core.exe') -Target $target -BackupDirectory $testRoot -Action {
            Assert (Test-Path -LiteralPath $target) 'Resource was not staged.'
        }
        Assert (-not (Test-Path -LiteralPath $target)) 'Generated resource leaked into the source tree.'
    }
    Test 'Build cleanup rejects a path outside its declared directory' {
        $safe = Join-Path $testRoot 'safe-cleanup'
        New-Item -ItemType Directory -Path $safe | Out-Null
        $outside = Join-Path $testRoot 'preserve.txt'
        [IO.File]::WriteAllText($outside, 'keep')
        $failed = $false
        try { Remove-BuildPath -Path (Join-Path $safe '../preserve.txt') -AllowedRoot $safe }
        catch { $failed = $_.Exception.Message -match 'fuera' }
        Assert ($failed -and (Test-Path -LiteralPath $outside)) 'Cleanup removed an out-of-bounds file.'
    }
    Test 'Native compiler exit failure aborts the step' {
        $failed = $false
        try { Invoke-CheckedNative -FilePath $env:ComSpec -Arguments @('/d', '/c', 'exit 23') -Step 'compiler' | Out-Null }
        catch { $failed = $_.Exception.Message -match 'compiler.*23' }
        Assert $failed 'Nonzero native exit was accepted.'
    }
    Test 'Native stderr warnings do not masquerade as a failed compiler' {
        $output = @(Invoke-CheckedNative -FilePath $env:ComSpec -Arguments @('/d', '/c', 'echo compiler-warning 1>&2 & exit 0') -Step 'compiler')
        Assert (($output -join ' ') -match 'compiler-warning') 'Native warning diagnostics were lost.'
    }
    Test 'ZIP bytes do not depend on filesystem ordering or file timestamps' {
        $source = Join-Path $testRoot 'zip-source'
        New-Item -ItemType Directory -Path (Join-Path $source 'nested') | Out-Null
        [IO.File]::WriteAllText((Join-Path $source 'z.txt'), 'zeta')
        [IO.File]::WriteAllText((Join-Path $source 'nested/a.txt'), 'alpha')
        $zip1 = Join-Path $testRoot 'one.zip'
        $zip2 = Join-Path $testRoot 'two.zip'
        New-DeterministicZip -SourceDirectory $source -Destination $zip1
        (Get-Item -LiteralPath (Join-Path $source 'z.txt')).LastWriteTime = [datetime]'2024-03-09'
        New-DeterministicZip -SourceDirectory $source -Destination $zip2
        Assert ((Get-FileHash -LiteralPath $zip1).Hash -eq (Get-FileHash -LiteralPath $zip2).Hash) 'Archive changed after input timestamp change.'
        $archive = [IO.Compression.ZipFile]::OpenRead($zip1)
        try {
            Assert (($archive.Entries.FullName -join ',') -eq 'nested/a.txt,z.txt') 'Entries were missing, unsorted or had Windows separators.'
            $reader = [IO.StreamReader]::new($archive.GetEntry('nested/a.txt').Open())
            try { Assert ($reader.ReadToEnd() -eq 'alpha') 'Archived file content was altered.' } finally { $reader.Dispose() }
        } finally { $archive.Dispose() }
    }
    Test 'Checksum manifest covers every explicitly shipped file by relative name' {
        $manifest = Join-Path $testRoot 'SHA256SUMS.txt'
        Write-ReleaseChecksums -RootDirectory $testRoot -Paths @((Join-Path $testRoot 'two.zip'), (Join-Path $testRoot 'core.exe')) -Destination $manifest
        $lines = @(Get-Content -LiteralPath $manifest)
        Assert ($lines.Count -eq 2) 'A deliverable is missing from the manifest.'
        Assert ($lines[0] -match '^[a-f0-9]{64}  core.exe$') 'Manifest name/order/format is not portable.'
        Assert ($lines[1] -eq ((Get-FileHash -LiteralPath (Join-Path $testRoot 'two.zip')).Hash.ToLowerInvariant() + '  two.zip')) 'ZIP checksum differs from delivered bytes.'
    }
    Test 'Requested signing fails closed when the signing tool fails' {
        $fakeTool = Join-Path $testRoot 'failed-signtool.cmd'
        [IO.File]::WriteAllText($fakeTool, "@echo off`r`nexit /b 7`r`n")
        $failed = $false
        try { Invoke-ReleaseSigning -FilePath (Join-Path $testRoot 'core.exe') -CertificateThumbprint ('A' * 40) -SignToolPath $fakeTool }
        catch { $failed = $_.Exception.Message -match 'firma.*7' }
        Assert $failed 'Signing failure was accepted as an unsigned release.'
    }
    Test 'Signing options cannot silently produce an unsigned release' {
        $failed = $false
        try { Resolve-ReleaseSignTool -CertificateThumbprint '' -SignToolPath 'missing.exe' -TimestampUrl '' | Out-Null }
        catch { $failed = $_.Exception.Message -match 'CertificateThumbprint' }
        Assert $failed 'A requested signer was ignored.'
    }
    Test 'Runtime audit rejects hidden MinGW dependencies' {
        Assert-NoBundledRuntimeDependencies -Imports @('KERNEL32.dll', 'api-ms-win-crt-runtime-l1-1-0.dll', 'wpcap.dll')
        $failed = $false
        try { Assert-NoBundledRuntimeDependencies -Imports @('KERNEL32.dll', 'libwinpthread-1.dll') }
        catch { $failed = $_.Exception.Message -match 'libwinpthread-1.dll' }
        Assert $failed 'EXE relying on a private compiler runtime was accepted.'
    }
    Test 'Real Windows executable receives version, icon and asInvoker resources' {
        $projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
        $windres = Join-Path $env:LOCALAPPDATA 'OpenRadar-Deox/build-cache/msys64/mingw64/bin/windres.exe'
        if (-not (Test-Path -LiteralPath $windres)) { $windres = 'C:/msys64/mingw64/bin/windres.exe' }
        if (-not (Test-Path -LiteralPath $windres)) { throw 'Resource smoke needs the existing MinGW windres tool; no tools are installed by this test.' }
        $fixture = Join-Path $testRoot 'resource-fixture'
        New-Item -ItemType Directory -Path $fixture | Out-Null
        [IO.File]::WriteAllText((Join-Path $fixture 'go.mod'), "module release-fixture`ngo 1.27`n")
        [IO.File]::WriteAllText((Join-Path $fixture 'main.go'), "package main`nfunc main() {}`n")
        $env:Path = (Split-Path -Parent $windres) + ';' + $env:Path
        $exe = Join-Path $fixture 'fixture.exe'
        foreach ($package in @('cmd/radar', 'cmd/launcher')) {
            New-WindowsResource -WindresPath $windres -MetadataPath (Join-Path $projectRoot ($package + '/versioninfo.json')) -ManifestPath (Join-Path $PSScriptRoot 'OpenRadar.manifest') -OutputPath (Join-Path $fixture 'resource_windows_amd64.syso')
            Push-Location $fixture
            try { Invoke-CheckedNative -FilePath 'go.exe' -Arguments @('build', '-buildvcs=false', '-trimpath', '-o', $exe, '.') -Step 'resource fixture' | Out-Host }
            finally { Pop-Location }
            $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
            Assert ($info.ProductVersion -eq '2.3ESP_Deox-V7.3.2') "Product version metadata was not linked for $package."
            Assert ($info.FileVersion -eq '2.3.0.732') "Numeric file version is stale for $package."
            $manifestBytes = Read-WindowsResource -FilePath $exe -Type 24 -Id 1
            [xml]$manifest = [Text.Encoding]::UTF8.GetString($manifestBytes)
            Assert ($manifest.assembly.assemblyIdentity.version -eq '2.3.0.732') "Manifest version is stale for $package."
            Assert ($manifest.assembly.trustInfo.security.requestedPrivileges.requestedExecutionLevel.level -eq 'asInvoker') 'EXE requests unnecessary elevation.'
            $dpi = $manifest.SelectSingleNode("//*[local-name()='dpiAwareness']")
            Assert ($null -ne $dpi -and $dpi.InnerText -eq 'PerMonitorV2, PerMonitor') 'Native screen coordinates need explicit DPI awareness.'
            $icon = Read-WindowsResource -FilePath $exe -Type 14 -Id 1
            Assert ($icon.Length -gt 6) 'Existing application icon was not embedded.'
        }
    }
    Test 'Successful tool exit does not replace verification of a real signature' {
        $fakeTool = Join-Path $testRoot 'empty-signtool.cmd'
        [IO.File]::WriteAllText($fakeTool, "@echo off`r`nexit /b 0`r`n")
        $failed = $false
        try { Invoke-ReleaseSigning -FilePath (Join-Path $testRoot 'resource-fixture/fixture.exe') -CertificateThumbprint ('A' * 40) -SignToolPath $fakeTool }
        catch { $failed = $_.Exception.Message -match 'firma no es valida' }
        Assert $failed 'A tool reporting success was trusted without a real verified signature.'
    }
    Write-Host "$count packaging tests passed."
} finally {
    # This is a uniquely created test directory beneath the system temp directory.
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
