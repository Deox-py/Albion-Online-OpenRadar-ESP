# Use the same checked, resource-enabled release pipeline for both entry points.
param(
    [switch]$NoInstall,
    [switch]$SkipQA,
    [switch]$Clean,
    [string]$CertificateThumbprint = '',
    [string]$SignToolPath = '',
    [string]$TimestampUrl = '',
    [ValidateSet('CurrentUser', 'LocalMachine')][string]$CertificateStoreLocation = 'CurrentUser'
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'AUTO-BUILD-2.3ESP_Deox.ps1') @PSBoundParameters
exit $LASTEXITCODE
