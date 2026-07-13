param(
  [ValidateSet("cosyvoice", "sensevoice", "mineru", "embedding")]
  [string[]]$Service = @("cosyvoice", "sensevoice", "mineru", "embedding"),
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path "$PSScriptRoot\..").Path
$rootLower = $root.ToLowerInvariant().TrimEnd("\")
$rootPrefixLower = "$rootLower\"

$serviceDefinitions = @{
  cosyvoice = @{
    PortMarkers = @("--port 50000", "--port=50000")
    ServiceMarkers = @("-service cosyvoice", "-service=cosyvoice", "service='cosyvoice'", 'service="cosyvoice"')
    PathMarkers = @(
      "scripts\cosyvoice-local-server.cmd",
      "scripts\cosyvoice-local-server.ps1",
      "dev\cosyvoice",
      "runtime\python\fastapi\server.py"
    )
    ScriptMarkers = @("cosyvoice-local-server.cmd", "cosyvoice-local-server.ps1", "runtime\python\fastapi\server.py")
  }
  sensevoice = @{
    PortMarkers = @("--port 50001", "--port=50001")
    ServiceMarkers = @("-service sensevoice", "-service=sensevoice", "service='sensevoice'", 'service="sensevoice"')
    PathMarkers = @(
      "scripts\sensevoice-local-server.cmd",
      "scripts\sensevoice-local-server.ps1",
      "scripts\watch-sensevoice.ps1",
      "scripts\sensevoice_server.py",
      "dev\sensevoice"
    )
    ScriptMarkers = @("sensevoice-local-server.cmd", "sensevoice-local-server.ps1", "watch-sensevoice.ps1", "sensevoice_server.py")
  }
  mineru = @{
    PortMarkers = @("--port 50002", "--port=50002")
    ServiceMarkers = @("-service mineru", "-service=mineru", "service='mineru'", 'service="mineru"')
    PathMarkers = @(
      "scripts\mineru-local-server.cmd",
      "scripts\mineru-local-server.ps1",
      "scripts\mineru_patch_gpu.py",
      "scripts\mineru_gpu_check.py",
      "dev\mineru",
      "mineru-api.exe"
    )
    ScriptMarkers = @("mineru-local-server.cmd", "mineru-local-server.ps1", "mineru-api.exe")
  }
  embedding = @{
    PortMarkers = @("--port 50003", "--port=50003", "BINGO_EMBEDDING_PORT=50003")
    ServiceMarkers = @("-service embedding", "-service=embedding", "service='embedding'", 'service="embedding"')
    PathMarkers = @(
      "scripts\chinese-xinhua-embedding-wsl-server.ps1",
      "scripts\chinese_xinhua_embedding_server.py",
      "dev\chinesexinhuaembedding"
    )
    ScriptMarkers = @("chinese-xinhua-embedding-wsl-server.ps1", "chinese_xinhua_embedding_server.py")
  }
}

function Test-ContainsAny {
  param(
    [string]$Text,
    [string[]]$Markers
  )

  foreach ($marker in $Markers) {
    if ($Text.Contains($marker.ToLowerInvariant())) {
      return $true
    }
  }
  return $false
}

function Test-ServiceProcess {
  param(
    [string]$CommandLine,
    [hashtable]$Definition
  )

  if (-not $CommandLine) {
    return $false
  }

  $normalized = $CommandLine.ToLowerInvariant().Replace("/", "\")
  $isInsideRepo = $normalized.Contains($rootPrefixLower)
  $hasPathMarker = Test-ContainsAny $normalized $Definition.PathMarkers
  $hasPortMarker = Test-ContainsAny $normalized $Definition.PortMarkers
  $hasServiceMarker = Test-ContainsAny $normalized $Definition.ServiceMarkers
  $hasScriptMarker = Test-ContainsAny $normalized $Definition.ScriptMarkers

  return $isInsideRepo -and ($hasPathMarker -or $hasServiceMarker) -and ($hasPortMarker -or $hasScriptMarker -or $hasServiceMarker)
}

function Add-ProcessTree {
  param(
    [int]$ProcessId,
    [hashtable]$ProcessById,
    [hashtable]$ChildrenByParent,
    [hashtable]$TargetIds
  )

  if ($TargetIds.ContainsKey($ProcessId)) {
    return
  }
  $TargetIds[$ProcessId] = $true

  $children = $ChildrenByParent[$ProcessId]
  if (-not $children) {
    return
  }

  foreach ($child in $children) {
    Add-ProcessTree `
      -ProcessId ([int]$child.ProcessId) `
      -ProcessById $ProcessById `
      -ChildrenByParent $ChildrenByParent `
      -TargetIds $TargetIds
  }
}

$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID })
$processById = @{}
$childrenByParent = @{}
foreach ($process in $processes) {
  $processById[[int]$process.ProcessId] = $process
  $parentId = [int]$process.ParentProcessId
  if (-not $childrenByParent.ContainsKey($parentId)) {
    $childrenByParent[$parentId] = New-Object System.Collections.ArrayList
  }
  [void]$childrenByParent[$parentId].Add($process)
}

$matchedByService = @{}
$targetIds = @{}
foreach ($serviceName in $Service) {
  $definition = $serviceDefinitions[$serviceName]
  $matchedByService[$serviceName] = New-Object System.Collections.ArrayList

  foreach ($process in $processes) {
    if (Test-ServiceProcess -CommandLine ([string]$process.CommandLine) -Definition $definition) {
      [void]$matchedByService[$serviceName].Add([int]$process.ProcessId)
      Add-ProcessTree `
        -ProcessId ([int]$process.ProcessId) `
        -ProcessById $processById `
        -ChildrenByParent $childrenByParent `
        -TargetIds $targetIds
    }
  }
}

$targets = @(
  $targetIds.Keys |
    ForEach-Object { $processById[[int]$_] } |
    Where-Object { $null -ne $_ } |
    Sort-Object @{ Expression = { [int]$_.ParentProcessId }; Descending = $true }, @{ Expression = { [int]$_.ProcessId }; Descending = $true }
)

foreach ($process in $targets) {
  $commandLine = ([string]$process.CommandLine).Replace("`r", " ").Replace("`n", " ")
  $message = "Matched PID $($process.ProcessId) [$($process.Name)] $commandLine"
  if ($DryRun) {
    Write-Output "DRY-RUN $message"
    continue
  }

  Write-Output "Stopping $message"
  try {
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
  } catch {
    Write-Warning "Failed to stop PID $($process.ProcessId): $($_.Exception.Message)"
  }
}

foreach ($serviceName in $Service) {
  $ids = @($matchedByService[$serviceName])
  Write-Output "$serviceName matched root processes: $($ids.Count)"
}

Write-Output "total target processes: $($targets.Count)"
