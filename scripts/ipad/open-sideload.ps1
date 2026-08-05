param(
  [string]$IpaPath = "D:\BinGo\Bingo\artifacts\ipad\BinGO-iPad-unsigned.ipa"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $IpaPath)) {
  throw "IPA not found: $IpaPath"
}

$candidates = @(
  "$env:ProgramFiles\Sideloadly\Sideloadly.exe",
  "${env:ProgramFiles(x86)}\Sideloadly\Sideloadly.exe",
  "$env:LOCALAPPDATA\Sideloadly\Sideloadly.exe"
)
$app = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $app) {
  throw "Sideloadly is not installed. Install it on Windows, then run this script again."
}

Start-Process -FilePath $app -ArgumentList @($IpaPath)
