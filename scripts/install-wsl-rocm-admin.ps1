param(
  [string]$DistroName = "Ubuntu-24.04"
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Invoke-NativeAllowRestart {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  $code = $LASTEXITCODE
  Write-Host "$FilePath exited with code $code"
  if ($code -ne 0 -and $code -ne 3010) {
    throw "Command failed: $FilePath $($Arguments -join ' ') (exit code $code)"
  }
}

function Test-WslUsable {
  & wsl.exe --status *> $null
  return $LASTEXITCODE -eq 0
}

function Invoke-WslUpdateIfPossible {
  & wsl.exe --update
  $code = $LASTEXITCODE
  Write-Host "wsl.exe --update exited with code $code"
  if ($code -eq 0 -or $code -eq 3010) {
    return
  }

  if (Test-WslUsable) {
    Write-Warning "wsl --update failed, but WSL is usable; continuing with existing WSL installation."
    return
  }

  throw "Command failed: wsl.exe --update (exit code $code)"
}

$root = (Resolve-Path "$PSScriptRoot\..").Path
$logPath = Join-Path $root "bingo-wsl-rocm-install.log"
Start-Transcript -Path $logPath -Append | Out-Null

try {
  Write-Step "Checking administrator privileges"
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script must be run as Administrator."
  }

  Write-Step "Enabling WSL and VirtualMachinePlatform Windows features"
  Invoke-NativeAllowRestart "dism.exe" @("/online", "/enable-feature", "/featurename:Microsoft-Windows-Subsystem-Linux", "/all", "/norestart")
  Invoke-NativeAllowRestart "dism.exe" @("/online", "/enable-feature", "/featurename:VirtualMachinePlatform", "/all", "/norestart")

  Write-Step "Installing/updating WSL"
  Invoke-WslUpdateIfPossible
  Invoke-NativeAllowRestart "wsl.exe" @("--set-default-version", "2")

  Write-Step "Installing $DistroName"
  $installed = (& wsl.exe -l -q 2>$null) -contains $DistroName
  if (-not $installed) {
    Invoke-NativeAllowRestart "wsl.exe" @("--install", "-d", $DistroName)
  }
  else {
    Write-Host "$DistroName is already installed."
  }

  Write-Step "Done"
  Write-Host "If Windows asks for a restart, restart the computer, then continue ROCm setup from Bingo."
}
finally {
  Stop-Transcript | Out-Null
}
