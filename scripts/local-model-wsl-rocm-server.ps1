param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("cosyvoice", "sensevoice", "mineru", "embedding")]
  [string]$Service,
  [int]$Port = 0,
  [string]$Distro = "",
  [string]$ModelId = "",
  [string]$ModelDir = "",
  [string]$HfEndpoint = "",
  [switch]$Install,
  [switch]$ForceInstall,
  [switch]$DownloadModels
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path "$PSScriptRoot\..").Path
$rootWsl = ($root -replace "\\", "/")
if ($rootWsl -match "^([A-Za-z]):/(.*)$") {
  $drive = $matches[1].ToLowerInvariant()
  $rest = $matches[2]
  $rootWsl = "/mnt/$drive/$rest"
}

function ConvertTo-WslTextPath {
  param([string]$Path)

  $wslPath = $Path -replace "\\", "/"
  if ($wslPath -match "^([A-Za-z]):/(.*)$") {
    $drive = $matches[1].ToLowerInvariant()
    $rest = $matches[2]
    return "/mnt/$drive/$rest"
  }
  return $wslPath
}

$runtimeRootWsl = if ([string]::IsNullOrWhiteSpace($env:BINGO_WSL_RUNTIME_ROOT)) {
  "~/.cache/bingo"
}
else {
  ConvertTo-WslTextPath $env:BINGO_WSL_RUNTIME_ROOT
}

$pipIndexUrl = if ([string]::IsNullOrWhiteSpace($env:BINGO_PIP_INDEX_URL)) {
  "https://pypi.tuna.tsinghua.edu.cn/simple"
}
else {
  $env:BINGO_PIP_INDEX_URL
}

$rocmWheelBaseUrl = if ([string]::IsNullOrWhiteSpace($env:BINGO_ROCM_WHEEL_BASE_URL)) {
  "https://repo.radeon.com/rocm/manylinux/rocm-rel-6.4.2"
}
else {
  $env:BINGO_ROCM_WHEEL_BASE_URL.TrimEnd("/")
}

$effectiveHfEndpoint = if (-not [string]::IsNullOrWhiteSpace($HfEndpoint)) {
  $HfEndpoint
}
elseif (-not [string]::IsNullOrWhiteSpace($env:HF_ENDPOINT)) {
  $env:HF_ENDPOINT
}
else {
  "https://hf-mirror.com"
}

$distroArgs = @()
if (-not [string]::IsNullOrWhiteSpace($Distro)) {
  $distroArgs = @("-d", $Distro)
}
elseif (-not [string]::IsNullOrWhiteSpace($env:BINGO_WSL_DISTRO)) {
  $distroArgs = @("-d", $env:BINGO_WSL_DISTRO)
}

$defaults = @{
  cosyvoice = @{
    Port = 50000
    Python = "auto"
    ServiceDir = "CosyVoice"
    ReadyMarker = ".bingo-cosyvoice-rocm-ready"
    ModelId = "FunAudioLLM/Fun-CosyVoice3-0.5B-2512"
    ModelDir = "pretrained_models/Fun-CosyVoice3-0.5B"
  }
  sensevoice = @{
    Port = 50001
    Python = "auto"
    ServiceDir = "SenseVoice"
    ReadyMarker = ".bingo-sensevoice-rocm-ready"
    ModelId = "iic/SenseVoiceSmall"
  }
  mineru = @{
    Port = 50002
    Python = "auto"
    ServiceDir = "MinerU"
    ReadyMarker = ".bingo-mineru-rocm-ready"
  }
  embedding = @{
    Port = 50003
    Python = "auto"
    ServiceDir = "ChineseXinhuaEmbedding"
    ReadyMarker = ".bingo-embedding-rocm-ready"
    ModelId = "BAAI/bge-base-zh-v1.5"
  }
}

$serviceDefault = $defaults[$Service]
if ($Port -le 0) {
  $Port = [int]$serviceDefault.Port
}
if ([string]::IsNullOrWhiteSpace($ModelId) -and $serviceDefault.ContainsKey("ModelId")) {
  $ModelId = [string]$serviceDefault.ModelId
}
if ([string]::IsNullOrWhiteSpace($ModelDir) -and $serviceDefault.ContainsKey("ModelDir")) {
  $ModelDir = [string]$serviceDefault.ModelDir
}

function Invoke-WslChecked {
  param([string]$Command)

  $result = Invoke-WslScript -Command $Command
  $exitCode = [int]$result.ExitCode
  if ($exitCode -ne 0) {
    $details = @(
      "WSL ROCm command failed for ${Service} with exit code $exitCode.",
      "STDOUT:",
      $result.Stdout,
      "STDERR:",
      $result.Stderr
    ) -join "`n"
    throw $details
  }
}

function Test-WslCommand {
  param([string]$Command)

  $result = Invoke-WslScript -Command $Command
  return [int]$result.ExitCode -eq 0
}

function ConvertTo-WslPath {
  param([string]$WindowsPath)

  $wslPath = $WindowsPath -replace "\\", "/"
  if ($wslPath -match "^([A-Za-z]):/(.*)$") {
    $drive = $matches[1].ToLowerInvariant()
    $rest = $matches[2]
    return "/mnt/$drive/$rest"
  }
  return $wslPath
}

function Invoke-WslScript {
  param([string]$Command)

  $tempFile = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), ".sh")
  $normalizedCommand = ($Command -replace "`r`n", "`n") -replace "`r", "`n"
  try {
    [System.IO.File]::WriteAllText(
      $tempFile,
      $normalizedCommand,
      [System.Text.UTF8Encoding]::new($false)
    )
    $scriptPath = ConvertTo-WslPath $tempFile
    $stdoutFile = [System.IO.Path]::GetTempFileName()
    $stderrFile = [System.IO.Path]::GetTempFileName()
    try {
      $process = Start-Process `
        -FilePath "wsl.exe" `
        -ArgumentList (@($distroArgs) + @("--exec", "bash", $scriptPath)) `
        -NoNewWindow `
        -Wait `
        -PassThru `
        -RedirectStandardOutput $stdoutFile `
        -RedirectStandardError $stderrFile
      $stdout = Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue
      $stderr = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
      if (-not [string]::IsNullOrWhiteSpace($stdout)) {
        Write-Host $stdout.TrimEnd()
      }
      if (-not [string]::IsNullOrWhiteSpace($stderr)) {
        Write-Error $stderr.TrimEnd() -ErrorAction Continue
      }
      return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $stdout
        Stderr = $stderr
      }
    }
    finally {
      Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    }
  }
  finally {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw "WSL is not available. Run scripts\launch-install-wsl-rocm-admin.vbs, then rerun Bingo."
}

& wsl.exe --status *> $null
if ($LASTEXITCODE -ne 0) {
  throw "WSL is not installed or not initialized. Run scripts\launch-install-wsl-rocm-admin.vbs."
}

$forceInstallFlag = if ($ForceInstall) { "1" } else { "0" }
$downloadModelsFlag = if ($DownloadModels) { "1" } else { "0" }
$pythonVersion = if ([string]::IsNullOrWhiteSpace($env:BINGO_WSL_PYTHON)) {
  [string]$serviceDefault.Python
}
else {
  $env:BINGO_WSL_PYTHON
}
$serviceDir = [string]$serviceDefault.ServiceDir
$readyMarker = [string]$serviceDefault.ReadyMarker

$setupCommand = @"
set -euo pipefail
cd '$rootWsl'
SERVICE='$Service'
PYTHON_VERSION='$pythonVersion'
RUNTIME_ROOT='$runtimeRootWsl'
RUNTIME_ROOT=`${RUNTIME_ROOT/#\~/`$HOME}
SERVICE_DIR="`$RUNTIME_ROOT/services/$serviceDir"
LOCK_DIR="`$SERVICE_DIR/.install.lock"
VENV_DIR="`$SERVICE_DIR/.venv"
VENV_PY="`$VENV_DIR/bin/python"
READY_MARKER="`$VENV_DIR/$readyMarker"
FORCE_INSTALL='$forceInstallFlag'
PIP_INDEX_URL='$pipIndexUrl'
ROCM_WHEEL_BASE_URL='$rocmWheelBaseUrl'
HF_ENDPOINT='$effectiveHfEndpoint'
PIP_CACHE_DIR="`$RUNTIME_ROOT/cache/pip"
ROCM_WHEEL_CACHE_DIR="`$RUNTIME_ROOT/cache/rocm-wheels"
TMPDIR="`$RUNTIME_ROOT/tmp"
export PIP_INDEX_URL ROCM_WHEEL_BASE_URL HF_ENDPOINT PIP_CACHE_DIR ROCM_WHEEL_CACHE_DIR TMPDIR
mkdir -p "`$SERVICE_DIR" "`$RUNTIME_ROOT/cache/hf" "`$RUNTIME_ROOT/cache/modelscope" "`$RUNTIME_ROOT/cache/pip" "`$ROCM_WHEEL_CACHE_DIR" "`$RUNTIME_ROOT/cache/torch" "`$RUNTIME_ROOT/cache/matplotlib" "`$RUNTIME_ROOT/cache/xdg" "`$RUNTIME_ROOT/data" "`$TMPDIR"
acquire_install_lock() {
  local waited=0
  until mkdir "`$LOCK_DIR" 2>/dev/null; do
    waited=`$((waited + 2))
    if [ "`$waited" -gt 1800 ]; then
      echo "Timed out waiting for Bingo `$SERVICE install lock at `$LOCK_DIR" >&2
      return 1
    fi
    sleep 2
  done
  trap 'rm -rf "`$LOCK_DIR"' EXIT
}
acquire_install_lock
install_apt_packages() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "apt-get is not available in WSL; cannot install system packages: `$*" >&2
    return 1
  fi

  if [ "`$(id -u)" -eq 0 ]; then
    APT_GET=(apt-get)
  elif command -v sudo >/dev/null 2>&1; then
    APT_GET=(sudo apt-get)
  else
    echo "Installing system packages requires root or sudo in WSL: `$*" >&2
    return 1
  fi

  export DEBIAN_FRONTEND=noninteractive
  "`${APT_GET[@]}" update
  "`${APT_GET[@]}" install -y --no-install-recommends "`$@"
}
ensure_system_dependencies() {
  case "`$SERVICE" in
    sensevoice)
      if ! command -v ffmpeg >/dev/null 2>&1; then
        install_apt_packages ffmpeg
      fi
      ;;
  esac
}
ensure_system_dependencies
resolve_python() {
  if [ -n "`$PYTHON_VERSION" ] && [ "`$PYTHON_VERSION" != "auto" ]; then
    if [[ "`$PYTHON_VERSION" =~ ^[0-9]+(\.[0-9]+)?`$ ]] && command -v "python`$PYTHON_VERSION" >/dev/null 2>&1; then
      command -v "python`$PYTHON_VERSION"
      return 0
    fi
    if command -v "`$PYTHON_VERSION" >/dev/null 2>&1; then
      command -v "`$PYTHON_VERSION"
      return 0
    fi
    echo "Configured BINGO_WSL_PYTHON/Python '`$PYTHON_VERSION' was not found in WSL." >&2
    return 1
  fi

  for candidate in python3.12 python3.10; do
    if command -v "`$candidate" >/dev/null 2>&1; then
      command -v "`$candidate"
      return 0
    fi
  done

  echo "Bingo WSL ROCm needs Python 3.10 or 3.12 for the bundled ROCm PyTorch wheels. Install python3.12-venv or python3.10-venv in WSL, or set BINGO_WSL_PYTHON." >&2
  return 1
}
PYTHON_BIN="`$(resolve_python)"
PYTHON_ABI="`$(`$PYTHON_BIN -c 'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}")')"
SHARED_SITE_PACKAGES="`$RUNTIME_ROOT/services/shared-runtime/`$PYTHON_ABI/site-packages"
SHARED_RUNTIME_PTH="`$VENV_DIR/lib/`$PYTHON_ABI/site-packages/zz-bingo-shared-rocm-runtime.pth"
export SHARED_SITE_PACKAGES
"`$PYTHON_BIN" - <<'PY'
import sys

if sys.version_info[:2] not in {(3, 10), (3, 12)}:
    raise SystemExit(
        f"Bingo WSL ROCm supports Python 3.10 or 3.12, current Python is {sys.version.split()[0]}"
    )
PY
if [ -x "`$VENV_PY" ]; then
  if ! "`$VENV_PY" - <<'PY'
import sys

raise SystemExit(0 if sys.version_info[:2] in {(3, 10), (3, 12)} else 1)
PY
  then
    echo 'Existing Bingo '"`$SERVICE"' venv uses an unsupported Python version; rebuilding it for WSL ROCm.' >&2
    rm -rf "`$VENV_DIR"
  fi
fi
if [ ! -x "`$VENV_PY" ]; then
  rm -rf "`$VENV_DIR"
  "`$PYTHON_BIN" -m venv --without-pip "`$VENV_DIR"
fi
if ! "`$VENV_PY" -m pip --version >/dev/null 2>&1; then
  GET_PIP="`$SERVICE_DIR/get-pip.py"
  export GET_PIP
  "`$PYTHON_BIN" - <<'PY'
import os
from pathlib import Path
from urllib.request import urlretrieve

target = Path(os.environ["GET_PIP"])
target.parent.mkdir(parents=True, exist_ok=True)
urlretrieve("https://bootstrap.pypa.io/get-pip.py", target)
PY
  "`$VENV_PY" "`$GET_PIP"
fi
mkdir -p "`$SHARED_SITE_PACKAGES" "`$(dirname "`$SHARED_RUNTIME_PTH")"
printf '%s\n' "`$SHARED_SITE_PACKAGES" > "`$SHARED_RUNTIME_PTH"
"`$VENV_PY" -m pip install --upgrade --only-binary=:all: pip wheel "setuptools<81"
if [ -f "`$READY_MARKER" ]; then
  if ! "`$VENV_PY" - <<'PY'
try:
    import torch

    raise SystemExit(0 if getattr(torch.version, "hip", None) else 1)
except Exception:
    raise SystemExit(1)
PY
  then
    echo "Existing Bingo `$SERVICE ready marker is stale; reinstalling the WSL ROCm environment." >&2
    rm -f "`$READY_MARKER"
  fi
fi
install_rocm_torch() {
  "`$VENV_PY" - <<'PY'
import os
from pathlib import Path
import fcntl
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse, unquote
from urllib.request import Request, urlopen

wheel_suffix = f"cp{sys.version_info.major}{sys.version_info.minor}-cp{sys.version_info.major}{sys.version_info.minor}-linux_x86_64.whl"
base_url = os.environ.get("ROCM_WHEEL_BASE_URL", "https://repo.radeon.com/rocm/manylinux/rocm-rel-6.4.2").rstrip("/")
cache_dir = Path(os.environ.get("ROCM_WHEEL_CACHE_DIR", "~/.cache/bingo/cache/rocm-wheels")).expanduser()
cache_dir.mkdir(parents=True, exist_ok=True)
shared_site_packages = Path(os.environ["SHARED_SITE_PACKAGES"]).expanduser()
shared_site_packages.mkdir(parents=True, exist_ok=True)
lock_path = shared_site_packages.parent / ".install.lock"


def wheel_url(filename: str) -> str:
    return f"{base_url}/{quote(filename)}"


wheel_sets = {
    "cp310-cp310-linux_x86_64.whl": [
        wheel_url("torch-2.6.0+rocm6.4.2.git76481f7c-cp310-cp310-linux_x86_64.whl"),
        wheel_url("torchvision-0.21.0+rocm6.4.2.git4040d51f-cp310-cp310-linux_x86_64.whl"),
        wheel_url("torchaudio-2.6.0+rocm6.4.2.gitd8831425-cp310-cp310-linux_x86_64.whl"),
        wheel_url("pytorch_triton_rocm-3.2.0+rocm6.4.2.git7e948ebf-cp310-cp310-linux_x86_64.whl"),
    ],
    "cp312-cp312-linux_x86_64.whl": [
        wheel_url("torch-2.6.0+rocm6.4.2.git76481f7c-cp312-cp312-linux_x86_64.whl"),
        wheel_url("torchvision-0.21.0+rocm6.4.2.git4040d51f-cp312-cp312-linux_x86_64.whl"),
        wheel_url("torchaudio-2.6.0+rocm6.4.2.gitd8831425-cp312-cp312-linux_x86_64.whl"),
        wheel_url("pytorch_triton_rocm-3.2.0+rocm6.4.2.git7e948ebf-cp312-cp312-linux_x86_64.whl"),
    ],
}


def filename_from_url(url: str) -> str:
    return unquote(Path(urlparse(url).path).name)


def remote_size(url: str) -> int | None:
    request = Request(url, method="HEAD")
    try:
        with urlopen(request, timeout=60) as response:
            content_length = response.headers.get("Content-Length")
            return int(content_length) if content_length else None
    except Exception:
        return None


def download_with_resume(url: str, target: Path) -> Path:
    expected_size = remote_size(url)
    if expected_size and target.exists() and target.stat().st_size == expected_size:
        print(f"Using cached ROCm wheel: {target}", flush=True)
        return target

    temp_target = target.with_suffix(target.suffix + ".part")
    offset = temp_target.stat().st_size if temp_target.exists() else 0
    if expected_size and offset > expected_size:
        temp_target.unlink()
        offset = 0

    attempts = 12
    for attempt in range(1, attempts + 1):
        headers = {}
        mode = "ab"
        if offset:
            headers["Range"] = f"bytes={offset}-"
        else:
            mode = "wb"

        print(
            f"Downloading ROCm wheel {target.name} "
            f"({offset}/{expected_size or 'unknown'} bytes, attempt {attempt}/{attempts})",
            flush=True,
        )
        request = Request(url, headers=headers)
        try:
            with urlopen(request, timeout=120) as response:
                if offset and response.status == 200:
                    temp_target.unlink(missing_ok=True)
                    offset = 0
                    mode = "wb"

                with temp_target.open(mode) as output:
                    while True:
                        chunk = response.read(8 * 1024 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
            offset = temp_target.stat().st_size
            if expected_size is None or offset == expected_size:
                temp_target.replace(target)
                return target
        except HTTPError as error:
            if error.code == 416 and expected_size and offset == expected_size:
                temp_target.replace(target)
                return target
            if offset and error.code == 200:
                temp_target.unlink(missing_ok=True)
                offset = 0
            else:
                print(f"ROCm wheel download failed: HTTP {error.code} {error.reason}", file=sys.stderr, flush=True)
        except (OSError, URLError, TimeoutError) as error:
            print(f"ROCm wheel download failed: {error}", file=sys.stderr, flush=True)

        if temp_target.exists():
            offset = temp_target.stat().st_size
        time.sleep(min(30, 2 * attempt))

    raise SystemExit(
        f"Failed to download ROCm wheel after {attempts} attempts: {url}. "
        f"Partial file is kept at {temp_target}; rerun the service test to resume."
    )


def has_rocm_torch() -> bool:
    try:
        import torch

        return bool(getattr(torch.version, "hip", None))
    except Exception:
        return False


with lock_path.open("w") as lock_file:
    fcntl.flock(lock_file, fcntl.LOCK_EX)
    if not has_rocm_torch():
        wheels = wheel_sets.get(wheel_suffix)
        if not wheels:
            raise SystemExit(
                f"ROCm wheel URLs are configured for Python 3.10 or 3.12, current Python is {sys.version.split()[0]}"
            )
        wheel_paths = [
            str(download_with_resume(url, cache_dir / filename_from_url(url)))
            for url in wheels
        ]
        subprocess.check_call([
            sys.executable,
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--no-deps",
            "--target",
            str(shared_site_packages),
            "--timeout",
            "120",
            "--retries",
            "10",
            "--resume-retries",
            "50",
            *wheel_paths,
        ])
PY
  "`$VENV_PY" - <<'PY'
from pathlib import Path
import importlib.util

torch_spec = importlib.util.find_spec("torch")
if not torch_spec or not torch_spec.origin:
    raise SystemExit("PyTorch is not installed.")

torch_dir = Path(torch_spec.origin).resolve().parent
for bundled_runtime in [
    torch_dir / "lib" / "libhsa-runtime64.so",
    torch_dir / "lib" / "libhsa-runtime64.so.1",
    torch_dir / "lib" / "libamdhip64.so",
    torch_dir / "lib" / "libamdhip64.so.6",
]:
    if bundled_runtime.exists():
        bundled_runtime.unlink()

import torch

if not getattr(torch.version, "hip", None):
    raise SystemExit(f"Installed PyTorch is not a ROCm build: torch={torch.__version__}")

if not torch.cuda.is_available():
    raise SystemExit("ROCm PyTorch is installed, but no HIP GPU is visible to torch.")
PY
}

install_filtered_requirements() {
  REQUIREMENTS_IN="`$1"
  REQUIREMENTS_OUT="`$(mktemp)"
  "`$PYTHON_BIN" - "`$REQUIREMENTS_IN" "`$REQUIREMENTS_OUT" <<'PY'
import re
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
skip = re.compile(
    r"^\s*(--extra-index-url|torch(?:vision|audio)?==|onnxruntime-gpu==|tensorrt|deepspeed==|grpcio(?:-tools)?==)",
    re.IGNORECASE,
)
lines = []
for line in source.read_text(encoding="utf-8").splitlines():
    if skip.match(line):
        lines.append(f"# filtered for WSL ROCm: {line}")
    else:
        lines.append(line)
target.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
  "`$VENV_PY" -m pip install -r "`$REQUIREMENTS_OUT"
  rm -f "`$REQUIREMENTS_OUT"
}
install_cosyvoice_rocm_requirements() {
  REQUIREMENTS_OUT="`$(mktemp)"
  cat > "`$REQUIREMENTS_OUT" <<'REQ'
conformer==0.3.2
diffusers==0.29.0
einops
fastapi==0.115.6
huggingface_hub==0.36.2
HyperPyYAML==1.2.3
inflect==7.3.1
librosa==0.10.2
matplotlib==3.7.5
more-itertools
numba
numpy==1.26.4
omegaconf==2.3.0
onnxruntime==1.18.0
protobuf==4.25
pydantic==2.7.0
python-multipart==0.0.12
regex
scipy
soundfile==0.12.1
tiktoken
tqdm
transformers==4.51.3
uvicorn==0.30.0
wetext==0.0.4
x-transformers==2.11.24
REQ
  "`$VENV_PY" -m pip install -r "`$REQUIREMENTS_OUT"
  rm -f "`$REQUIREMENTS_OUT"
  "`$VENV_PY" -m pip install --no-build-isolation --no-deps openai-whisper==20231117
}
install_transformers_rocm_compat() {
  "`$VENV_PY" -m pip install --upgrade \
    "transformers==4.51.3" \
    "huggingface_hub==0.36.2" \
    "tokenizers>=0.21,<0.22"
}
install_mineru_transformers_rocm_compat() {
  "`$VENV_PY" -m pip install --upgrade \
    "transformers==4.57.6" \
    "huggingface_hub==0.36.2" \
    "tokenizers>=0.22,<0.23"
}
if [ "`$FORCE_INSTALL" = "1" ] || [ ! -f "`$READY_MARKER" ]; then
  case "`$SERVICE" in
    cosyvoice)
      "`$VENV_PY" -m pip install --upgrade "setuptools<70"
      install_rocm_torch
      install_cosyvoice_rocm_requirements
      ;;
    sensevoice)
      install_rocm_torch
      "`$VENV_PY" -m pip install -r scripts/sensevoice-requirements.txt
      install_transformers_rocm_compat
      "`$VENV_PY" -m pip install --force-reinstall --no-deps "numpy==1.26.4"
      ;;
    mineru)
      install_rocm_torch
      "`$VENV_PY" -m pip install --no-deps "mineru[pipeline]"
      "`$VENV_PY" -m pip install --force-reinstall --no-deps "numpy==1.26.4"
      "`$VENV_PY" -m pip install \
        "antlr4-python3-runtime==4.9.3" "omegaconf==2.3.0" \
        dill PyYAML ftfy shapely pyclipper transformers onnxruntime albumentations \
        opencv-python huggingface-hub modelscope click pypdfium2 reportlab pdftext json-repair boto3 \
        pillow pypdf loguru requests pdfminer.six httpx tqdm \
        beautifulsoup4 "fast-langdetect>=0.2.3,<0.3.0" fastapi lxml magika mammoth "mineru-vl-utils>=0.2.7,<1" openai openpyxl \
        "pandas>=2.3.3,<3" pylatexenc pypptx-with-oxml python-docx python-multipart qwen-vl-utils scikit-image uvicorn
      install_mineru_transformers_rocm_compat
      "`$VENV_PY" -m pip install --force-reinstall --no-deps "numpy==1.26.4"
      ;;
    embedding)
      "`$VENV_PY" -m pip install --only-binary=:all: fastapi uvicorn numpy pydantic
      install_transformers_rocm_compat
      ;;
  esac
  install_rocm_torch
  touch "`$READY_MARKER"
fi
install_rocm_torch
"@

$probeCommand = @"
set -e
RUNTIME_ROOT='$runtimeRootWsl'
RUNTIME_ROOT=`${RUNTIME_ROOT/#\~/`$HOME}
VENV_PY="`$RUNTIME_ROOT/services/$serviceDir/.venv/bin/python"
READY_MARKER="`$RUNTIME_ROOT/services/$serviceDir/.venv/$readyMarker"
test -x "`$VENV_PY" -a -f "`$READY_MARKER"
"`$VENV_PY" - <<'PY'
import torch

raise SystemExit(0 if getattr(torch.version, "hip", None) else 1)
PY
"@

$needsInstall = $Install -or -not (Test-WslCommand $probeCommand)
if ($needsInstall) {
  Invoke-WslChecked $setupCommand
}

$commonRunPrefix = @"
set -euo pipefail
cd '$rootWsl'
SERVICE='$Service'
RUNTIME_ROOT='$runtimeRootWsl'
RUNTIME_ROOT=`${RUNTIME_ROOT/#\~/`$HOME}
VENV_PY="`$RUNTIME_ROOT/services/$serviceDir/.venv/bin/python"
if [ ! -x "`$VENV_PY" ]; then
  echo '$Service ROCm environment is not installed and automatic setup did not complete.' >&2
  exit 2
fi
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export HF_HOME="`$RUNTIME_ROOT/cache/hf"
export HF_ENDPOINT='$effectiveHfEndpoint'
export MPLCONFIGDIR="`$RUNTIME_ROOT/cache/matplotlib"
export MODELSCOPE_CACHE="`$RUNTIME_ROOT/cache/modelscope"
export MODELSCOPE_CACHE_HOME="`$RUNTIME_ROOT/cache/modelscope"
export MODELSCOPE_MODULES_CACHE="`$RUNTIME_ROOT/cache/modelscope/modules"
export TORCH_HOME="`$RUNTIME_ROOT/cache/torch"
export XDG_CACHE_HOME="`$RUNTIME_ROOT/cache/xdg"
export TMPDIR="`$RUNTIME_ROOT/tmp"
mkdir -p "`$HF_HOME" "`$MPLCONFIGDIR" "`$MODELSCOPE_CACHE" "`$MODELSCOPE_MODULES_CACHE" "`$TORCH_HOME" "`$XDG_CACHE_HOME" "`$TMPDIR"
install_apt_packages() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "apt-get is not available in WSL; cannot install system packages: `$*" >&2
    return 1
  fi

  if [ "`$(id -u)" -eq 0 ]; then
    APT_GET=(apt-get)
  elif command -v sudo >/dev/null 2>&1; then
    APT_GET=(sudo apt-get)
  else
    echo "Installing system packages requires root or sudo in WSL: `$*" >&2
    return 1
  fi

  export DEBIAN_FRONTEND=noninteractive
  "`${APT_GET[@]}" update
  "`${APT_GET[@]}" install -y --no-install-recommends "`$@"
}
ensure_system_dependencies() {
  case "`$SERVICE" in
    sensevoice)
      if ! command -v ffmpeg >/dev/null 2>&1; then
        install_apt_packages ffmpeg
      fi
      ;;
  esac
}
ensure_system_dependencies
"`$VENV_PY" - <<'PY'
import torch

if not getattr(torch.version, "hip", None):
    raise SystemExit(f"Installed PyTorch is not a ROCm build: torch={torch.__version__}")
if not torch.cuda.is_available():
    raise SystemExit("ROCm PyTorch is installed, but no HIP GPU is visible to torch.")
print(
    "ROCm torch ready: torch={} hip={} device_count={} device={}".format(
        torch.__version__,
        torch.version.hip,
        torch.cuda.device_count(),
        torch.cuda.get_device_name(0) if torch.cuda.device_count() else "none",
    ),
    flush=True,
)
PY
"@

switch ($Service) {
  "cosyvoice" {
    $modelIdForShell = $ModelId
    $modelDirForShell = $ModelDir
    $runCommand = @"
$commonRunPrefix
cd dev/CosyVoice
MODEL_DIR='$modelDirForShell'
if [ ! -f "`$MODEL_DIR/cosyvoice3.yaml" ] || [ ! -f "`$MODEL_DIR/llm.pt" ]; then
  "`$VENV_PY" -m huggingface_hub.commands.huggingface_cli download '$modelIdForShell' --local-dir "`$MODEL_DIR" --resume-download --exclude .DS_Store
fi
if [ -f "`$MODEL_DIR/llm.rl.pt" ]; then
  [ -f "`$MODEL_DIR/llm.base.pt" ] || cp "`$MODEL_DIR/llm.pt" "`$MODEL_DIR/llm.base.pt"
  cp "`$MODEL_DIR/llm.rl.pt" "`$MODEL_DIR/llm.pt"
fi
export COSYVOICE_DEVICE=cuda
COSYVOICE_FP16_FLAG=""
if [ "`${BINGO_COSYVOICE_FP16:-0}" = "1" ]; then
  COSYVOICE_FP16_FLAG="--fp16"
fi
exec "`$VENV_PY" runtime/python/fastapi/server.py --model_dir "`$MODEL_DIR" --port '$Port' --device cuda `$COSYVOICE_FP16_FLAG
"@
  }
  "sensevoice" {
    $modelIdForShell = $ModelId
    $downloadCommand = if ($downloadModelsFlag -eq "1") {
      "`"`$VENV_PY`" - <<'PY'`nfrom funasr import AutoModel`nAutoModel(model='$modelIdForShell', vad_model='fsmn-vad', device='cuda', disable_update=True)`nprint('SenseVoice models are downloaded and loadable.', flush=True)`nPY"
    } else { "true" }
    $runCommand = @"
$commonRunPrefix
export SENSEVOICE_DEVICE=cuda
export BINGO_REQUIRE_ROCM=1
export SENSEVOICE_MODEL='$modelIdForShell'
$downloadCommand
exec "`$VENV_PY" scripts/sensevoice_server.py --model '$modelIdForShell' --port '$Port' --device cuda
"@
  }
  "mineru" {
    $downloadCommand = if ($downloadModelsFlag -eq "1") { "`"`$VENV_PY`" -m mineru.cli.models_download --source `"`$MINERU_MODEL_SOURCE`" --model_type pipeline" } else { "true" }
    $runCommand = @"
$commonRunPrefix
export MINERU_MODEL_SOURCE="`${MINERU_MODEL_SOURCE:-modelscope}"
export BINGO_REQUIRE_ROCM=1
export MINERU_DEVICE_MODE=cuda
export BINGO_MINERU_ACCELERATOR=rocm
export BINGO_MINERU_LAYOUT_ACCELERATOR=cuda
export BINGO_MINERU_MFR_ACCELERATOR=cuda
export BINGO_MINERU_OCR_ACCELERATOR=cuda
export MINERU_API_MAX_CONCURRENT_REQUESTS="`${MINERU_API_MAX_CONCURRENT_REQUESTS:-1}"
export MINERU_PROCESSING_WINDOW_SIZE="`${MINERU_PROCESSING_WINDOW_SIZE:-32}"
export MINERU_API_OUTPUT_ROOT="`$RUNTIME_ROOT/services/MinerU/output"
export BINGO_MINERU_TRT_CACHE="`$RUNTIME_ROOT/services/MinerU/trt-cache"
mkdir -p "`$MINERU_API_OUTPUT_ROOT" "`$BINGO_MINERU_TRT_CACHE"
"`$VENV_PY" scripts/mineru_patch_gpu.py
echo 'MinerU ROCm/runtime probe:'
"`$VENV_PY" scripts/mineru_gpu_check.py
$downloadCommand
exec "`$VENV_PY" -m mineru.cli.fast_api --host 0.0.0.0 --port '$Port'
"@
  }
  "embedding" {
    $modelIdForShell = $ModelId
    $runCommand = @"
$commonRunPrefix
export BINGO_EMBEDDING_MODEL='$modelIdForShell'
export BINGO_REQUIRE_ROCM=1
export BINGO_EMBEDDING_PORT='$Port'
export BINGO_CHINESE_XINHUA_DATA='$rootWsl/data/chinese-xinhua/data'
export BINGO_CHINESE_XINHUA_INDEX="`$RUNTIME_ROOT/data/chinese-xinhua-index"
export TRANSFORMERS_CACHE="`$HF_HOME"
mkdir -p "`$BINGO_CHINESE_XINHUA_INDEX"
exec "`$VENV_PY" -m uvicorn scripts.chinese_xinhua_embedding_server:app --host 0.0.0.0 --port '$Port'
"@
  }
}

Invoke-WslChecked $runCommand
