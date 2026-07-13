param(
  [int]$Port = 50001,
  [int]$IntervalSeconds = 10
)

$ErrorActionPreference = "Continue"

$root = Resolve-Path "$PSScriptRoot\.."
Set-Location $root

function Test-PortListening {
  param([int]$Port)

  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  return $null -ne $connection
}

function Test-SenseVoiceStarting {
  $existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $commandLine = [string]$_.CommandLine
      $commandLine.Contains("sensevoice-local-server.ps1") -or
      ($commandLine.Contains("local-model-wsl-rocm-server.ps1") -and $commandLine.Contains("sensevoice")) -or
      ($commandLine.Contains("wsl.exe") -and $commandLine.Contains("bash -s"))
    } |
    Select-Object -First 1

  if ($existing) {
    return $true
  }

  try {
    & wsl.exe --exec bash -lc "ps -eo cmd | grep -E '/root/.cache/bingo/services/SenseVoice|scripts/sensevoice_server.py' | grep -v grep >/dev/null"
    return $LASTEXITCODE -eq 0
  }
  catch {
    return $false
  }
}

function Start-SenseVoice {
  if (Test-PortListening $Port) {
    return
  }
  if (Test-SenseVoiceStarting) {
    return
  }

  Start-Process `
    -FilePath "powershell" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "$root\scripts\sensevoice-local-server.ps1",
      "-Port",
      "$Port"
    ) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root "bingo-sensevoice.log") `
    -RedirectStandardError (Join-Path $root "bingo-sensevoice.err.log") | Out-Null
}

while ($true) {
  try {
    Start-SenseVoice
  } catch {
    Add-Content -Path (Join-Path $root "bingo-sensevoice-watchdog.err.log") -Value (
      "$(Get-Date -Format o) $($_.Exception.Message)"
    )
  }

  Start-Sleep -Seconds $IntervalSeconds
}
