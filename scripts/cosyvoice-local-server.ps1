param(
  [string]$InstallDir = "$PSScriptRoot\..\dev\CosyVoice",
  [string]$ModelId = "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
  [string]$ModelDir = "pretrained_models\Fun-CosyVoice3-0.5B",
  [string]$HfEndpoint = "https://hf-mirror.com",
  [int]$Port = 50000,
  [string]$Distro = "",
  [switch]$ForceInstall
)

$ErrorActionPreference = "Stop"

if ($env:BINGO_LOCAL_MODEL_RUNTIME -and $env:BINGO_LOCAL_MODEL_RUNTIME.ToLowerInvariant() -eq "windows") {
  throw "Windows-native CosyVoice startup has been disabled by default. Clear BINGO_LOCAL_MODEL_RUNTIME or use the WSL ROCm launcher."
}

$modelDirForWsl = $ModelDir -replace "\\", "/"
$launcherParams = @{
  Service = "cosyvoice"
  Port = $Port
  ModelId = $ModelId
  ModelDir = $modelDirForWsl
  HfEndpoint = $HfEndpoint
}
if (-not [string]::IsNullOrWhiteSpace($Distro)) {
  $launcherParams.Distro = $Distro
}
if ($ForceInstall) {
  $launcherParams.ForceInstall = $true
}

& "$PSScriptRoot\local-model-wsl-rocm-server.ps1" @launcherParams

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
