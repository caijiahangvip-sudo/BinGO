import json
import os
import platform
import shutil
import subprocess


def has_command(name: str) -> bool:
    return shutil.which(name) is not None


def powershell_gpus() -> list[str]:
    if platform.system() != "Windows" or not has_command("powershell"):
        return []
    try:
        output = subprocess.check_output(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
            ],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
    except Exception:
        return []
    return [line.strip() for line in output.splitlines() if line.strip()]


def main() -> None:
    import onnxruntime as ort
    import torch
    require_rocm = os.getenv("BINGO_REQUIRE_ROCM", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }

    info: dict[str, object] = {
        "platform": platform.platform(),
        "gpus": powershell_gpus(),
        "torch": getattr(torch, "__version__", "unknown"),
        "torch_cuda": bool(torch.cuda.is_available()),
        "torch_hip": getattr(torch.version, "hip", None),
        "torch_cuda_device_count": torch.cuda.device_count(),
        "onnxruntime": getattr(ort, "__version__", "unknown"),
        "onnxruntime_providers": ort.get_available_providers(),
        "mineru_device_mode": os.getenv("MINERU_DEVICE_MODE", ""),
        "bingo_mineru_accelerator": os.getenv("BINGO_MINERU_ACCELERATOR", ""),
        "bingo_mineru_layout_accelerator": os.getenv(
            "BINGO_MINERU_LAYOUT_ACCELERATOR", ""
        ),
        "bingo_mineru_mfr_accelerator": os.getenv("BINGO_MINERU_MFR_ACCELERATOR", ""),
        "bingo_mineru_ocr_accelerator": os.getenv("BINGO_MINERU_OCR_ACCELERATOR", ""),
        "mineru_virtual_vram_size": os.getenv("MINERU_VIRTUAL_VRAM_SIZE", ""),
        "mineru_processing_window_size": os.getenv("MINERU_PROCESSING_WINDOW_SIZE", ""),
    }

    info["torch_cuda_devices"] = []
    if torch.cuda.is_available():
        info["torch_cuda_devices"] = [
            torch.cuda.get_device_name(index) for index in range(torch.cuda.device_count())
        ]

    print(json.dumps(info, ensure_ascii=False, indent=2))
    if require_rocm:
        if not getattr(torch.version, "hip", None):
            raise SystemExit(f"MinerU requires ROCm PyTorch; installed torch={torch.__version__}.")
        if not torch.cuda.is_available():
            raise SystemExit("MinerU requires a visible ROCm/HIP GPU.")


if __name__ == "__main__":
    main()
