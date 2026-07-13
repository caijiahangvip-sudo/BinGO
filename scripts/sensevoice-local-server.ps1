param(
  [string]$InstallDir = "$PSScriptRoot\..\dev\SenseVoice",
  [string]$ModelId = "iic/SenseVoiceSmall",
  [int]$Port = 50001,
  [string]$Distro = "",
  [switch]$ForceInstall,
  [switch]$DownloadModels
)

$ErrorActionPreference = "Stop"

if ($env:BINGO_LOCAL_MODEL_RUNTIME -and $env:BINGO_LOCAL_MODEL_RUNTIME.ToLowerInvariant() -eq "windows") {
  throw "Windows-native SenseVoice startup has been disabled by default. Clear BINGO_LOCAL_MODEL_RUNTIME or use the WSL ROCm launcher."
}

$launcherParams = @{
  Service = "sensevoice"
  Port = $Port
  ModelId = $ModelId
}
if (-not [string]::IsNullOrWhiteSpace($Distro)) {
  $launcherParams.Distro = $Distro
}
if ($ForceInstall) {
  $launcherParams.ForceInstall = $true
}
if ($DownloadModels) {
  $launcherParams.DownloadModels = $true
}

& "$PSScriptRoot\local-model-wsl-rocm-server.ps1" @launcherParams

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
