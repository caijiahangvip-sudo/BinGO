param([int]$Port = 50004)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
$serviceRoot = Join-Path $root "dev\SpecializedModels"
$venvRoot = Join-Path $serviceRoot ".venv"
$python = Join-Path $venvRoot "Scripts\python.exe"
$requirementsStamp = Join-Path $serviceRoot ".bingo-requirements-v1"

New-Item -ItemType Directory -Force -Path $serviceRoot | Out-Null

if (-not (Test-Path $python)) {
  $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($launcher) {
    & py.exe -3.11 -m venv $venvRoot
  } else {
    $systemPython = Get-Command python.exe -ErrorAction Stop
    & $systemPython.Source -m venv $venvRoot
  }
}

if (-not (Test-Path $requirementsStamp)) {
  & $python -m pip install --upgrade pip wheel setuptools
  & $python -m pip install fastapi "uvicorn[standard]" python-multipart pillow numpy soundfile
  & $python -m pip install paddlepaddle "paddleocr[doc-parser]"
  & $python -m pip install sentence-transformers
  & $python -m pip install "git+https://github.com/myshell-ai/MeloTTS.git"
  & $python -m unidic download
  New-Item -ItemType File -Force -Path $requirementsStamp | Out-Null
}

$env:BINGO_SPECIALIZED_MODEL_PORT = "$Port"
$env:HF_HOME = if ($env:HF_HOME) { $env:HF_HOME } else { Join-Path $serviceRoot "cache\hf" }
$env:PADDLE_HOME = if ($env:PADDLE_HOME) { $env:PADDLE_HOME } else { Join-Path $serviceRoot "cache\paddle" }
$env:MODELSCOPE_CACHE = if ($env:MODELSCOPE_CACHE) { $env:MODELSCOPE_CACHE } else { Join-Path $serviceRoot "cache\modelscope" }
$env:BINGO_SPECIALIZED_MODEL_STATE = Join-Path $serviceRoot "installed-models.json"
New-Item -ItemType Directory -Force -Path $env:HF_HOME, $env:PADDLE_HOME, $env:MODELSCOPE_CACHE | Out-Null

Set-Location $root
& $python -m uvicorn scripts.specialized_model_server:app --host 127.0.0.1 --port $Port
