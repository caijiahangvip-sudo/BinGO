function Get-BingoRuntimeRoot {
  param(
    [string]$ProjectRoot = "$PSScriptRoot\.."
  )

  $override = $env:BINGO_RUNTIME_ROOT
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    return [System.IO.Path]::GetFullPath($override)
  }

  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    return [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Bingo"))
  }

  $resolvedProjectRoot = [System.IO.Path]::GetFullPath((Resolve-Path $ProjectRoot))
  return [System.IO.Path]::GetFullPath((Join-Path $resolvedProjectRoot "runtime-data"))
}

function Get-BingoRuntimePaths {
  param(
    [string]$ProjectRoot = "$PSScriptRoot\..",
    [string]$RuntimeRoot
  )

  if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) {
    $RuntimeRoot = Get-BingoRuntimeRoot -ProjectRoot $ProjectRoot
  }

  $cacheRoot = Join-Path $RuntimeRoot "cache"
  [pscustomobject]@{
    RuntimeRoot = $RuntimeRoot
    CacheRoot = $cacheRoot
    DataRoot = Join-Path $RuntimeRoot "data"
    LogsRoot = Join-Path $RuntimeRoot "logs"
    ServicesRoot = Join-Path $RuntimeRoot "services"
    UVCache = Join-Path $cacheRoot "uv"
    UVPython = Join-Path $cacheRoot "uv-python"
    HFHome = Join-Path $cacheRoot "hf"
    Matplotlib = Join-Path $cacheRoot "matplotlib"
    Modelscope = Join-Path $cacheRoot "modelscope"
    TorchHome = Join-Path $cacheRoot "torch"
    XdgCache = Join-Path $cacheRoot "xdg"
  }
}

function Ensure-BingoDirectories {
  param([string[]]$Paths)

  foreach ($path in $Paths) {
    if ([string]::IsNullOrWhiteSpace($path)) {
      continue
    }

    if (-not (Test-Path $path)) {
      New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
  }
}
