param(
  [string]$OutputDir = "Bingo2.0",
  [switch]$SkipBuild,
  [switch]$SkipBackupExport,
  [switch]$SkipSmokeTest
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = $null
  )

  if ($WorkingDirectory) {
    Push-Location $WorkingDirectory
  }

  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed: $FilePath $($Arguments -join ' ')"
    }
  }
  finally {
    if ($WorkingDirectory) {
      Pop-Location
    }
  }
}

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

function Wait-ForHttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    }
    catch {
      Start-Sleep -Seconds 1
    }
  }

  throw "Timed out waiting for $Url"
}

function Copy-DirectoryContents {
  param(
    [string]$SourceDir,
    [string]$DestinationDir
  )

  if (-not (Test-Path $SourceDir)) {
    return
  }

  New-Item -ItemType Directory -Path $DestinationDir -Force | Out-Null
  & robocopy $SourceDir $DestinationDir /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed while copying $SourceDir to $DestinationDir (exit code $LASTEXITCODE)"
  }
}

function Copy-PathIfExists {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )

  if (-not (Test-Path $SourcePath)) {
    return
  }

  $parent = Split-Path -Parent $DestinationPath
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $item = Get-Item -LiteralPath $SourcePath
  if ($item.PSIsContainer) {
    Copy-DirectoryContents -SourceDir $SourcePath -DestinationDir $DestinationPath
    return
  }

  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
}

function Get-AllowedLocalOrigins {
  return [ordered]@{
    "http://localhost:4000" = 0
    "http://127.0.0.1:4000" = 1
    "http://localhost:3001" = 2
    "http://127.0.0.1:3001" = 3
    "http://localhost:3000" = 4
    "http://127.0.0.1:3000" = 5
  }
}

function Get-OpenmaicProfilePath {
  if (-not $env:APPDATA) {
    return $null
  }

  $path = Join-Path $env:APPDATA "openmaic"
  if (-not (Test-Path $path)) {
    return $null
  }

  return (Resolve-Path $path).Path.TrimEnd('\')
}

function Get-BackupSlug {
  param(
    [string]$ProfilePath,
    [string]$Origin
  )

  $profileLabel = Split-Path -Leaf $ProfilePath
  if ([string]::IsNullOrWhiteSpace($profileLabel)) {
    $profileLabel = "profile"
  }

  $combined = "$profileLabel-$Origin".ToLowerInvariant()
  return ($combined -replace '^https?://', '' -replace '[^a-z0-9._-]+', '-').Trim('-')
}

function Get-IndexedDbProfileCandidates {
  param([string]$RootPath)

  if (-not (Test-Path $RootPath)) {
    return @()
  }

  $indexedDbRoot = Join-Path $RootPath "IndexedDB"
  if (-not (Test-Path $indexedDbRoot)) {
    return @()
  }

  $allowedOrigins = Get-AllowedLocalOrigins
  $preferredProfilePath = Get-OpenmaicProfilePath
  $resolvedRootPath = (Resolve-Path $RootPath).Path.TrimEnd('\')
  $results = @()
  Get-ChildItem -LiteralPath $indexedDbRoot -Directory -Filter "*.indexeddb.leveldb" | ForEach-Object {
    if ($_.Name -match '^(https?)_(.+)_(\d+)\.indexeddb\.leveldb$') {
      $origin = "$($matches[1])://$($matches[2]):$($matches[3])"
      if (-not $allowedOrigins.Contains($origin)) {
        return
      }

      $originPreference = [int]$allowedOrigins[$origin]
      $profilePreference = if ($preferredProfilePath -and $resolvedRootPath -ieq $preferredProfilePath) { 0 } else { 100 }
      $results += [pscustomobject]@{
        ProfilePath = $RootPath
        Origin = $origin
        LastWriteTime = $_.LastWriteTimeUtc
        IndexedDbPath = $_.FullName
        PreferenceScore = $profilePreference + $originPreference
      }
    }
  }

  return $results
}

function Get-ProfileCandidates {
  $candidateRoots = @()

  if ($env:APPDATA) {
    $candidateRoots += (Join-Path $env:APPDATA "openmaic")
  }

  if ($env:LOCALAPPDATA) {
    $chromeRoot = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
    $edgeRoot = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data"

    foreach ($browserRoot in @($chromeRoot, $edgeRoot)) {
      if (-not (Test-Path $browserRoot)) {
        continue
      }

      Get-ChildItem -LiteralPath $browserRoot -Directory |
        Where-Object { $_.Name -eq "Default" -or $_.Name -like "Profile *" } |
        ForEach-Object { $candidateRoots += $_.FullName }
    }
  }

  $results = @()
  foreach ($rootPath in ($candidateRoots | Select-Object -Unique)) {
    $results += Get-IndexedDbProfileCandidates -RootPath $rootPath
  }

  return $results |
    Group-Object Origin |
    ForEach-Object {
      $_.Group |
        Sort-Object @{ Expression = "LastWriteTime"; Descending = $true }, PreferenceScore |
        Select-Object -First 1
    } |
    Sort-Object @{ Expression = "LastWriteTime"; Descending = $true }, PreferenceScore
}

function Start-TemporaryExportServer {
  param(
    [string]$Root,
    [string]$Origin
  )

  $uri = [System.Uri]$Origin
  $healthUrl = "$Origin/api/health"
  $stdoutPath = Join-Path $Root ".bingo-export-server.log"
  $stderrPath = Join-Path $Root ".bingo-export-server.err.log"

  if (Test-PortListening -Port $uri.Port) {
    Wait-ForHttpReady -Url $healthUrl -TimeoutSeconds 20
    return [pscustomobject]@{
      Owned = $false
      Process = $null
    }
  }

  $nodeExe = (Get-Command node -ErrorAction Stop).Source
  $serverScript = Join-Path $Root ".next\standalone\server.js"
  if (-not (Test-Path $serverScript)) {
    throw "Standalone server not found: $serverScript"
  }

  $previousPort = $env:PORT
  $previousHostName = $env:HOSTNAME
  $previousNodeEnv = $env:NODE_ENV

  $env:PORT = [string]$uri.Port
  $env:HOSTNAME = $uri.Host
  $env:NODE_ENV = "production"

  try {
    $process = Start-Process `
      -FilePath $nodeExe `
      -ArgumentList @($serverScript) `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath
  }
  finally {
    $env:PORT = $previousPort
    $env:HOSTNAME = $previousHostName
    $env:NODE_ENV = $previousNodeEnv
  }

  Wait-ForHttpReady -Url $healthUrl -TimeoutSeconds 120
  return [pscustomobject]@{
    Owned = $true
    Process = $process
  }
}

function Stop-TemporaryExportServer {
  param($ServerHandle)

  if ($null -eq $ServerHandle -or -not $ServerHandle.Owned -or $null -eq $ServerHandle.Process) {
    return
  }

  try {
    Stop-Process -Id $ServerHandle.Process.Id -Force -ErrorAction SilentlyContinue
  }
  catch {
    Write-Warning "Failed to stop temporary export server: $_"
  }
}

function Stop-ProcessesListeningOnPorts {
  param([int[]]$Ports)

  foreach ($port in $Ports | Select-Object -Unique) {
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        try {
          Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
        catch {
          Write-Warning "Failed to stop process $_ on port ${port}: $($_.Exception.Message)"
        }
      }
  }
}

function Stop-SenseVoiceWatchdogProcesses {
  param([int[]]$Ports)

  foreach ($port in $Ports | Select-Object -Unique) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        ([string]$_.CommandLine).Contains("watch-sensevoice.ps1") -and
        ([string]$_.CommandLine).Contains("-Port $port")
      } |
      ForEach-Object {
        try {
          Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
        catch {
          Write-Warning "Failed to stop SenseVoice watchdog $($_.ProcessId): $($_.Exception.Message)"
        }
      }
  }
}

function Write-PortableStartScripts {
  param([string]$PackageRoot)

  $ps1Path = Join-Path $PackageRoot "Start-Bingo2.ps1"
  $cmdPath = Join-Path $PackageRoot "Start-Bingo2.cmd"

  $ps1Content = @'
param(
  [string]$HostName = "127.0.0.1",
  [int]$AppPort = 4000,
  [int]$CosyVoicePort = 50000,
  [int]$SenseVoicePort = 50001,
  [int]$MinerUPort = 50002,
  [int]$EmbeddingPort = 50003
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path $PSScriptRoot
Set-Location $root

function Import-EnvFile {
  param([string]$FilePath)

  if (-not (Test-Path $FilePath)) {
    return
  }

  foreach ($line in Get-Content -LiteralPath $FilePath) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.TrimStart().StartsWith("#")) { continue }
    $pair = $line.Split("=", 2)
    if ($pair.Count -ne 2) { continue }
    $name = $pair[0].Trim()
    $value = $pair[1].Trim().Trim("'`"")
    [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

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

& (Join-Path $root "scripts\repair-portable-python.ps1") -Root $root
Import-EnvFile (Join-Path $root "config\.env.local")

$runtimePathEntries = @(
  (Join-Path $root "runtime\node"),
  (Join-Path $root "runtime\uv"),
  (Join-Path $root "runtime\ffmpeg\bin")
) | Where-Object { Test-Path $_ }

if ($runtimePathEntries.Count -gt 0) {
  $env:PATH = (($runtimePathEntries + @($env:PATH)) -join ";")
}

$env:NODE_ENV = "production"
$env:HOSTNAME = $HostName
$env:PORT = [string]$AppPort
$env:COSYVOICE_PORT = [string]$CosyVoicePort
$env:SENSEVOICE_PORT = [string]$SenseVoicePort
$env:MINERU_PORT = [string]$MinerUPort
$env:BINGO_EMBEDDING_PORT = [string]$EmbeddingPort
$env:TTS_COSYVOICE_BASE_URL = "http://localhost:$CosyVoicePort"
$env:ASR_SENSEVOICE_BASE_URL = "http://localhost:$SenseVoicePort"
$env:PDF_MINERU_LOCAL_BASE_URL = "http://localhost:$MinerUPort"
$env:BINGO_EMBEDDING_BASE_URL = "http://localhost:$EmbeddingPort"

Write-Host "Local model services will start on demand when testing or using them."

if (Test-PortListening $AppPort) {
  Write-Host "Bingo app is already listening on port $AppPort."
}
else {
  Write-Host "Starting Bingo app on http://$HostName`:$AppPort."
  Start-Process `
    -FilePath (Join-Path $root "runtime\node\node.exe") `
    -ArgumentList @((Join-Path $root "app\server.js")) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root "bingo-app.log") `
    -RedirectStandardError (Join-Path $root "bingo-app.err.log") | Out-Null
}

Write-Host "Bingo2.0 local URL: http://$HostName`:$AppPort"
'@

  $cmdContent = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Bingo2.ps1"
'@

  Set-Content -LiteralPath $ps1Path -Value $ps1Content -Encoding UTF8
  Set-Content -LiteralPath $cmdPath -Value $cmdContent -Encoding ASCII
}

$root = [System.IO.Path]::GetFullPath((Resolve-Path "$PSScriptRoot\.."))
Set-Location $root

$outputRoot = if ([System.IO.Path]::IsPathRooted($OutputDir)) {
  [System.IO.Path]::GetFullPath($OutputDir)
}
else {
  [System.IO.Path]::GetFullPath((Join-Path $root $OutputDir))
}

$expectedOutputRoot = Join-Path $root "Bingo2.0"
if ($outputRoot -ne $expectedOutputRoot) {
  Write-Warning "Output path overridden to $outputRoot"
}

if (-not $SkipBuild) {
  Invoke-Checked "pnpm" @("exec", "next", "build", "--webpack") $root
}

if (-not (Test-Path ".next\standalone\server.js")) {
  throw "Standalone build output is missing. Run a successful production build first."
}

if (Test-Path $outputRoot) {
  $resolvedOutput = [System.IO.Path]::GetFullPath($outputRoot)
  $resolvedExpected = [System.IO.Path]::GetFullPath($expectedOutputRoot)
  if ($resolvedOutput -ne $resolvedExpected) {
    throw "Refusing to remove unexpected output directory: $resolvedOutput"
  }
  Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot "app") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot "config") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot "runtime\node") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot "runtime\uv") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot "runtime\ffmpeg\bin") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot "seed") -Force | Out-Null

Copy-DirectoryContents -SourceDir (Join-Path $root ".next\standalone") -DestinationDir (Join-Path $outputRoot "app")
Copy-DirectoryContents -SourceDir (Join-Path $root "node_modules\.pnpm\node_modules") -DestinationDir (Join-Path $outputRoot "app\node_modules")
Copy-DirectoryContents -SourceDir (Join-Path $root ".next\static") -DestinationDir (Join-Path $outputRoot "app\.next\static")
Copy-DirectoryContents -SourceDir (Join-Path $root "public") -DestinationDir (Join-Path $outputRoot "app\public")
Copy-DirectoryContents -SourceDir (Join-Path $root "scripts") -DestinationDir (Join-Path $outputRoot "scripts")
Copy-DirectoryContents -SourceDir (Join-Path $root "tools") -DestinationDir (Join-Path $outputRoot "tools")
Copy-DirectoryContents -SourceDir (Join-Path $root "dev") -DestinationDir (Join-Path $outputRoot "dev")

foreach ($cacheDirName in @(".uv-python", ".uv-cache", ".hf-cache", ".modelscope-cache", ".torch-cache", ".matplotlib-cache", ".cache")) {
  Copy-PathIfExists -SourcePath (Join-Path $root $cacheDirName) -DestinationPath (Join-Path $outputRoot $cacheDirName)
}

if (Test-Path (Join-Path $root ".env.local")) {
  Copy-Item -LiteralPath (Join-Path $root ".env.local") -Destination (Join-Path $outputRoot "config\.env.local") -Force
}

$nodeExe = (Get-Command node -ErrorAction Stop).Source
$uvExe = (Get-Command uv -ErrorAction Stop).Source
$ffmpegExe = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffmpegBinDir = Split-Path -Parent $ffmpegExe

Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $outputRoot "runtime\node\node.exe") -Force
Copy-Item -LiteralPath $uvExe -Destination (Join-Path $outputRoot "runtime\uv\uv.exe") -Force

$uvxExe = Join-Path (Split-Path -Parent $uvExe) "uvx.exe"
if (Test-Path $uvxExe) {
  Copy-Item -LiteralPath $uvxExe -Destination (Join-Path $outputRoot "runtime\uv\uvx.exe") -Force
}

Copy-DirectoryContents -SourceDir $ffmpegBinDir -DestinationDir (Join-Path $outputRoot "runtime\ffmpeg\bin")
Write-PortableStartScripts -PackageRoot $outputRoot

if (-not $SkipBackupExport) {
  $profileCandidates = @(Get-ProfileCandidates)
  if ($profileCandidates.Count -eq 0) {
    throw "Could not find a Chromium profile with Bingo IndexedDB data to export."
  }

  $seedRoot = Join-Path $outputRoot "seed"
  $backupVariantsRoot = Join-Path $seedRoot "backups"
  New-Item -ItemType Directory -Path $backupVariantsRoot -Force | Out-Null

  $successfulBackups = @()
  foreach ($profileCandidate in $profileCandidates) {
    $slug = Get-BackupSlug -ProfilePath $profileCandidate.ProfilePath -Origin $profileCandidate.Origin
    $relativeBackupPath = "Bingo2.0/seed/backups/$slug.zip"

    Write-Host "Exporting backup from profile: $($profileCandidate.ProfilePath)"
    Write-Host "Exporting backup origin: $($profileCandidate.Origin)"

    try {
      Invoke-Checked "node" @(
        (Join-Path $root "scripts\export-local-backup-with-profile.mjs"),
        "--profile-path", $profileCandidate.ProfilePath,
        "--origin", $profileCandidate.Origin,
        "--output-path", $relativeBackupPath
      ) $root

      $successfulBackups += [pscustomobject]@{
        ProfilePath = $profileCandidate.ProfilePath
        Origin = $profileCandidate.Origin
        LastWriteTime = $profileCandidate.LastWriteTime
        Slug = $slug
        RelativePath = "seed/backups/$slug.zip"
      }
    }
    catch {
      Write-Warning "Failed to export backup from $($profileCandidate.Origin) using $($profileCandidate.ProfilePath): $($_.Exception.Message)"
    }
  }

  if ($successfulBackups.Count -eq 0) {
    throw "Could not export any Bingo local backup snapshot."
  }

  $defaultBackup = $successfulBackups | Select-Object -First 1
  Copy-Item `
    -LiteralPath (Join-Path $outputRoot $defaultBackup.RelativePath) `
    -Destination (Join-Path $seedRoot "user-backup.zip") `
    -Force

  $backupIndex = [pscustomobject]@{
    defaultBackup = $defaultBackup.RelativePath
    backups = @($successfulBackups | Select-Object ProfilePath, Origin, LastWriteTime, Slug, RelativePath)
  }
  $backupIndex | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $seedRoot "backup-index.json") -Encoding UTF8
}

if (-not $SkipSmokeTest) {
  $startScript = Join-Path $outputRoot "Start-Bingo2.ps1"
  $smokeLog = Join-Path $outputRoot "bingo-package-smoke.log"
  $smokeErr = Join-Path $outputRoot "bingo-package-smoke.err.log"
  $smokeAppPort = 3100
  $smokeCosyPort = 51000
  $smokeSensePort = 51001
  $smokeMinerUPort = 51002
  $smokeEmbeddingPort = 51003

  $smokeProcess = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $startScript,
      "-AppPort", "$smokeAppPort",
      "-CosyVoicePort", "$smokeCosyPort",
      "-SenseVoicePort", "$smokeSensePort",
      "-MinerUPort", "$smokeMinerUPort",
      "-EmbeddingPort", "$smokeEmbeddingPort"
    ) `
    -WorkingDirectory $outputRoot `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $smokeLog `
    -RedirectStandardError $smokeErr

  try {
    Wait-ForHttpReady -Url "http://127.0.0.1:$smokeAppPort/api/health" -TimeoutSeconds 180
  }
  finally {
    Stop-SenseVoiceWatchdogProcesses -Ports @($smokeSensePort)
    Stop-Process -Id $smokeProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-ProcessesListeningOnPorts -Ports @(
      $smokeAppPort,
      $smokeCosyPort,
      $smokeSensePort,
      $smokeMinerUPort,
      $smokeEmbeddingPort
    )
  }
}

Write-Host "Bingo2.0 package is ready at: $outputRoot"
