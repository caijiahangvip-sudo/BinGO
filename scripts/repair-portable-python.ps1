param(
  [string]$Root = "$PSScriptRoot\.."
)

$ErrorActionPreference = "Stop"

$resolvedRoot = [System.IO.Path]::GetFullPath((Resolve-Path $Root))
$pythonHome = Join-Path $resolvedRoot ".uv-python\cpython-3.10-windows-x86_64-none"

function Update-PyVenvConfig {
  param([string]$ConfigPath)

  if (-not (Test-Path $ConfigPath)) {
    return
  }

  $lines = Get-Content -LiteralPath $ConfigPath
  $updated = @()
  $homeUpdated = $false

  foreach ($line in $lines) {
    if ($line -match '^home = ') {
      $updated += "home = $pythonHome"
      $homeUpdated = $true
    }
    else {
      $updated += $line
    }
  }

  if (-not $homeUpdated) {
    $updated = @("home = $pythonHome") + $updated
  }

  Set-Content -LiteralPath $ConfigPath -Value $updated -Encoding UTF8
}

foreach ($relativeConfigPath in @(
    "dev\CosyVoice\.venv\pyvenv.cfg",
    "dev\SenseVoice\.venv\pyvenv.cfg",
    "dev\MinerU\.venv\pyvenv.cfg"
  )) {
  Update-PyVenvConfig -ConfigPath (Join-Path $resolvedRoot $relativeConfigPath)
}
