param(
  [int]$Port = 50003,
  [string]$Distro = "",
  [string]$ModelId = "BAAI/bge-base-zh-v1.5",
  [switch]$Install
)

$ErrorActionPreference = "Stop"

$launcherParams = @{
  Service = "embedding"
  Port = $Port
  ModelId = $ModelId
}
if (-not [string]::IsNullOrWhiteSpace($Distro)) {
  $launcherParams.Distro = $Distro
}
if ($Install) {
  $launcherParams.Install = $true
}

& "$PSScriptRoot\local-model-wsl-rocm-server.ps1" @launcherParams
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
