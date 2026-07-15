param(
  [string]$DistroName = "Ubuntu-24.04",
  [string]$RocmVersion = "6.4.2",
  [string]$AmdGpuInstallUrl = "https://repo.radeon.com/amdgpu-install/6.4.2/ubuntu/noble/amdgpu-install_6.4.60402-1_all.deb"
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

function Install-RocmInWsl {
  param(
    [string]$Distro,
    [string]$Version,
    [string]$InstallerUrl
  )

  $setupScript = @"
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

gpu_name() {
  rocminfo 2>/dev/null | sed -n 's/^[[:space:]]*Marketing Name:[[:space:]]*\(AMD Radeon.*\)$/\1/p' | head -n 1 | sed 's/[[:space:]]*$//'
}

if command -v rocminfo >/dev/null 2>&1; then
  GPU_NAME="`$(gpu_name || true)"
  if [ -n "`$GPU_NAME" ]; then
    echo "ROCm/HIP is already ready: `$GPU_NAME"
    rocminfo >/dev/null
    exit 0
  fi
fi

echo "Installing AMD ROCm $Version for WSL..."
apt-get update
apt-get install -y --no-install-recommends ca-certificates wget python3-setuptools python3-wheel
INSTALLER_DEB="/tmp/amdgpu-install.deb"
wget -O "`$INSTALLER_DEB" '$InstallerUrl'
dpkg -i "`$INSTALLER_DEB"
apt-get update
amdgpu-install -y --usecase=wsl,rocm --no-dkms
rm -f "`$INSTALLER_DEB"

GPU_NAME="`$(gpu_name || true)"
if [ -z "`$GPU_NAME" ]; then
  echo "ROCm installation completed, but no AMD Radeon HIP device is visible." >&2
  echo "Update the Windows AMD Software: Adrenalin Edition driver, run wsl --update, then restart Windows." >&2
  exit 1
fi

echo "ROCm/HIP ready: `$GPU_NAME"
rocminfo >/dev/null
"@

  $encodedScript = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($setupScript))
  & wsl.exe -d $Distro -u root --exec bash -lc "echo '$encodedScript' | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) {
    throw "ROCm setup failed in WSL distro $Distro (exit code $LASTEXITCODE)."
  }
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

  Write-Step "Configuring AMD ROCm/HIP in $DistroName"
  Install-RocmInWsl -Distro $DistroName -Version $RocmVersion -InstallerUrl $AmdGpuInstallUrl

  Write-Step "Done"
  Write-Host "WSL and AMD ROCm/HIP are ready. Return to Bingo and refresh GPU diagnostics."
}
finally {
  Stop-Transcript | Out-Null
}
