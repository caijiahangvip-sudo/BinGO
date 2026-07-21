param(
  [int]$AppPort = 4000,
  [int]$CosyVoicePort = 50000,
  [int]$SenseVoicePort = 50001,
  [int]$MinerUPort = 50002,
  [int]$EmbeddingPort = 50003,
  [switch]$CleanNextCache
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path "$PSScriptRoot\.."
Set-Location $root

function Test-PortListening {
  param([int]$Port)

  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($connection) {
    return $true
  }

  try {
    $wslArgs = @()
    if (-not [string]::IsNullOrWhiteSpace($env:BINGO_WSL_DISTRO)) {
      $wslArgs += @("-d", $env:BINGO_WSL_DISTRO)
    }
    $wslArgs += @("--exec", "hostname", "-I")
    $addresses = (& wsl.exe @wslArgs 2>$null) -split "\s+" |
      Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' }
    foreach ($address in $addresses) {
      $client = New-Object System.Net.Sockets.TcpClient
      $async = $client.BeginConnect($address, $Port, $null, $null)
      if ($async.AsyncWaitHandle.WaitOne(800, $false)) {
        $client.EndConnect($async)
        $client.Close()
        return $true
      }
      $client.Close()
    }
  }
  catch {
  }

  return $false
}

function Get-WslCommandPrefix {
  $wslArgs = @()
  if (-not [string]::IsNullOrWhiteSpace($env:BINGO_WSL_DISTRO)) {
    $wslArgs += @("-d", $env:BINGO_WSL_DISTRO)
  }
  return $wslArgs
}

function Resolve-WslPath {
  param([string]$Path)

  try {
    $wslArgs = Get-WslCommandPrefix
    $wslPath = (& wsl.exe @wslArgs --exec wslpath -a "$Path" 2>$null | Select-Object -First 1)
    if (-not [string]::IsNullOrWhiteSpace($wslPath)) {
      return $wslPath.Trim()
    }
  }
  catch {
  }

  return $null
}

function Invoke-WslScriptFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Script,
    [string[]]$Arguments = @()
  )

  $tempFile = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), ".sh")
  try {
    $normalizedScript = ($Script -replace "`r`n", "`n") -replace "`r", "`n"
    [System.IO.File]::WriteAllText(
      $tempFile,
      $normalizedScript,
      [System.Text.UTF8Encoding]::new($false)
    )

    $wslArgs = Get-WslCommandPrefix
    $wslScriptPath = Resolve-WslPath $tempFile
    if ([string]::IsNullOrWhiteSpace($wslScriptPath)) {
      return $false
    }

    & wsl.exe @wslArgs --exec bash "$wslScriptPath" @Arguments
    return $LASTEXITCODE -eq 0
  }
  finally {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  }
}

function Stop-WindowsBingoAppOnPort {
  param([int]$Port)

  $rootText = [string]$root
  $processIds = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($processId in $processIds) {
    try {
      $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
      $commandLine = "$($processInfo.CommandLine) $($processInfo.ExecutablePath)"
      if (($commandLine -like "*$rootText*") -and ($commandLine -match "next|next-server|pnpm|node")) {
        Write-Host "Stopping existing Bingo app process $processId on port $Port."
        Stop-Process -Id $processId -Force -ErrorAction Stop
      }
    }
    catch {
    }
  }
}

function Stop-WslBingoAppOnPort {
  param([int]$Port)

  try {
    $wslArgs = Get-WslCommandPrefix
    $wslRoot = Resolve-WslPath ([string]$root)
    if ([string]::IsNullOrWhiteSpace($wslRoot)) {
      return
    }

    $script = @'
port="$1"
root="$2"

is_bingo_next_process() {
  pid="$1"
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)

  case "$cwd" in
    "$root"|"$root"/*) in_root=1 ;;
    *) in_root=0 ;;
  esac

  case "$cmd" in
    *"next dev"*|*"next-server"*|*"node"*"next/dist/bin/next"*|*"pnpm dev"*|*"pnpm"*"next"*|*"sh -c next"*) nextish=1 ;;
    *) nextish=0 ;;
  esac

  [ "$in_root" = "1" ] && [ "$nextish" = "1" ]
}

if command -v ss >/dev/null 2>&1; then
  pids=$(ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u)
elif command -v lsof >/dev/null 2>&1; then
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)
else
  pids=""
fi

targets=""
for pid in $pids; do
  current="$pid"
  while [ -n "$current" ] && [ "$current" != "1" ]; do
    if is_bingo_next_process "$current"; then
      targets="$targets $current"
      parent=$(sed -E 's/^[0-9]+ \(.*\) [A-Z] ([0-9]+).*/\1/' "/proc/$current/stat" 2>/dev/null || true)
      current="$parent"
    else
      break
    fi
  done
done

for pid in $(printf '%s\n' $targets | sort -rn | uniq); do
  kill "$pid" 2>/dev/null || true
done
'@

    Invoke-WslScriptFile -Script $script -Arguments @("$Port", "$wslRoot") | Out-Null
  }
  catch {
  }
}

function Start-WslBingoApp {
  param([int]$Port)

  $wslRoot = Resolve-WslPath ([string]$root)
  $wslAppLog = Resolve-WslPath (Join-Path $root "bingo-app.log")
  $wslErrLog = Resolve-WslPath (Join-Path $root "bingo-app.err.log")

  if ([string]::IsNullOrWhiteSpace($wslRoot) -or
      [string]::IsNullOrWhiteSpace($wslAppLog) -or
      [string]::IsNullOrWhiteSpace($wslErrLog)) {
    return $false
  }

  $script = @'
set -eu

root="$1"
port="$2"
cosy_port="$3"
sense_port="$4"
mineru_port="$5"
embedding_port="$6"
app_log="$7"
err_log="$8"

cd "$root"

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  node_bin_dir=$(find "$HOME/.nvm/versions/node" -maxdepth 3 -type f -name node -executable -printf '%h\n' 2>/dev/null | sort -V | tail -n 1 || true)
  if [ -n "$node_bin_dir" ]; then
    export PATH="$node_bin_dir:$PATH"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not available in WSL. Install Node in the selected WSL distro or make it available on PATH." >&2
  exit 127
fi

if [ ! -f node_modules/next/dist/bin/next ]; then
  echo "Next.js is not installed at $root/node_modules/next/dist/bin/next" >&2
  exit 127
fi

export COSYVOICE_PORT="$cosy_port"
export SENSEVOICE_PORT="$sense_port"
export MINERU_PORT="$mineru_port"
export BINGO_EMBEDDING_PORT="$embedding_port"
export BINGO_LOCAL_MODEL_RUNTIME="rocm"
export TTS_COSYVOICE_BASE_URL="http://localhost:$cosy_port"
export ASR_SENSEVOICE_BASE_URL="http://localhost:$sense_port"
export PDF_MINERU_LOCAL_BASE_URL="http://localhost:$mineru_port"
export BINGO_EMBEDDING_BASE_URL="http://localhost:$embedding_port"

setsid node node_modules/next/dist/bin/next dev --webpack --hostname 0.0.0.0 --port "$port" > "$app_log" 2> "$err_log" </dev/null &
child_pid="$!"
disown "$child_pid" 2>/dev/null || true

for _ in $(seq 1 60); do
  if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$port" | grep -q ":$port"; then
    exit 0
  fi
  if ! kill -0 "$child_pid" 2>/dev/null; then
    echo "Bingo WSL app process exited before port $port was ready." >&2
    if [ -f "$err_log" ]; then
      tail -80 "$err_log" >&2 || true
    fi
    exit 1
  fi
  sleep 1
done

echo "Timed out waiting for Bingo WSL app on port $port." >&2
if [ -f "$err_log" ]; then
  tail -80 "$err_log" >&2 || true
fi
exit 1
'@

  try {
    return Invoke-WslScriptFile -Script $script -Arguments @(
      "$wslRoot",
      "$Port",
      "$CosyVoicePort",
      "$SenseVoicePort",
      "$MinerUPort",
      "$EmbeddingPort",
      "$wslAppLog",
      "$wslErrLog"
    )
  }
  catch {
    return $false
  }
}

function Wait-PortReleased {
  param([int]$Port)

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (-not (Test-PortListening $Port)) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Start-BingoProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments,
    [int]$Port
  )

  if (Test-PortListening $Port) {
    Write-Host "$Name is already listening on port $Port."
    return
  }

  Write-Host "Starting $Name on port $Port."
  Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root "bingo-$Name.log") `
    -RedirectStandardError (Join-Path $root "bingo-$Name.err.log") | Out-Null
}

$env:COSYVOICE_PORT = [string]$CosyVoicePort
$env:SENSEVOICE_PORT = [string]$SenseVoicePort
$env:MINERU_PORT = [string]$MinerUPort
$env:BINGO_EMBEDDING_PORT = [string]$EmbeddingPort
$env:BINGO_LOCAL_MODEL_RUNTIME = "rocm"
$env:TTS_COSYVOICE_BASE_URL = "http://localhost:$CosyVoicePort"
$env:ASR_SENSEVOICE_BASE_URL = "http://localhost:$SenseVoicePort"
$env:PDF_MINERU_LOCAL_BASE_URL = "http://localhost:$MinerUPort"
$env:BINGO_EMBEDDING_BASE_URL = "http://localhost:$EmbeddingPort"

Write-Host "Local model services will start on demand when testing or using them."

if ($CleanNextCache) {
  Stop-WindowsBingoAppOnPort $AppPort
  Stop-WslBingoAppOnPort $AppPort
  if (Wait-PortReleased $AppPort) {
    $nextDevCache = Join-Path $root ".next\dev"
    if (Test-Path $nextDevCache) {
      Write-Host "Removing stale Next dev cache: $nextDevCache"
      Remove-Item $nextDevCache -Recurse -Force
    }
  }
  else {
    Write-Host "Port $AppPort is still busy; keeping existing app process and Next dev cache."
  }
}

if (Test-PortListening $AppPort) {
  Write-Host "Bingo app is already listening on port $AppPort."
}
else {
  Write-Host "Starting Bingo app on http://localhost:$AppPort."
  if (Start-WslBingoApp $AppPort) {
    Write-Host "Started Bingo app through WSL."
  }
  else {
    Write-Host "WSL start failed; falling back to Windows pnpm."
    $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if (-not $pnpmCommand) {
      $pnpmCommand = Get-Command pnpm -ErrorAction Stop
    }
    Start-Process `
      -FilePath $pnpmCommand.Source `
      -ArgumentList "exec", "next", "dev", "--webpack", "--hostname", "localhost", "--port", "$AppPort" `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $root "bingo-app.log") `
      -RedirectStandardError (Join-Path $root "bingo-app.err.log") | Out-Null
  }
}

# 启动 SenseVoice（常驻模式，不再按需启动）
if (Test-PortListening $SenseVoicePort) {
  Write-Host "SenseVoice is already listening on port $SenseVoicePort."
}
else {
  Write-Host "Starting SenseVoice on port $SenseVoicePort..."
  $sensevoiceScript = Join-Path $root "scripts\sensevoice-local-server.ps1"
  if (Test-Path $sensevoiceScript) {
    Start-Process `
      -FilePath "powershell.exe" `
      -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $sensevoiceScript, "-SenseVoicePort", $SenseVoicePort `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $root "bingo-sensevoice-start.log") `
      -RedirectStandardError (Join-Path $root "bingo-sensevoice-start.err.log") | Out-Null
    Write-Host "SenseVoice start command issued. Check bingo-sensevoice-start.log for details."
  }
  else {
    Write-Host "SenseVoice launch script not found at $sensevoiceScript. SenseVoice will start on demand."
  }
}

Write-Host "Bingo local URL: http://localhost:$AppPort"
