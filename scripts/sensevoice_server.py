from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from funasr import AutoModel


LANGUAGE_MAP = {
    "auto": "auto",
    "zh": "zh",
    "zh-cn": "zh",
    "zh-tw": "zh",
    "yue": "yue",
    "en": "en",
    "ja": "ja",
    "ko": "ko",
}

MODEL_ALIASES = {
    "SenseVoiceLarge": "iic/SenseVoiceSmall",
    "SenseVoice-Large": "iic/SenseVoiceSmall",
    "FunAudioLLM/SenseVoiceLarge": "iic/SenseVoiceSmall",
    "iic/SenseVoiceLarge": "iic/SenseVoiceSmall",
    "SenseVoiceSmall": "iic/SenseVoiceSmall",
}

app = FastAPI(title="Bingo SenseVoice Local ASR")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

args: argparse.Namespace
model: AutoModel | None = None
selected_device = "uninitialized"
selected_accelerator = "uninitialized"
model_id = "iic/SenseVoiceSmall"
model_warmed = False
REQUIRE_ROCM = os.environ.get("BINGO_REQUIRE_ROCM", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def normalize_model_id(requested_model: str | None) -> str:
    requested = (requested_model or model_id).strip() or model_id
    return MODEL_ALIASES.get(requested, requested)


def normalize_language(language: str | None) -> str:
    key = (language or "auto").strip().lower()
    return LANGUAGE_MAP.get(key, "auto")


def clean_text(value: Any) -> str:
    if isinstance(value, list):
        return " ".join(clean_text(item) for item in value).strip()
    if isinstance(value, dict):
        return clean_text(value.get("text", ""))
    text = str(value or "")
    text = re.sub(r"<\|[^|]+?\|>", "", text)
    text = text.replace("\n", " ").strip()
    return re.sub(r"\s+", " ", text)


def select_device(requested_device: str) -> tuple[str, str]:
    requested = (requested_device or "auto").lower()
    torch_hip = getattr(torch.version, "hip", None)
    if REQUIRE_ROCM and not torch_hip:
        raise RuntimeError(
            f"SenseVoice requires ROCm PyTorch; installed torch={torch.__version__}."
        )
    if requested in {"cuda", "auto", "rocm"} and torch.cuda.is_available():
        return "cuda", "rocm" if torch_hip else "cuda"
    raise RuntimeError(
        f"SENSEVOICE_DEVICE={requested_device} requested, but no ROCm/HIP GPU is visible to torch."
    )


def convert_to_wav(input_path: Path) -> Path:
    output_path = input_path.with_suffix(".wav")
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(output_path),
    ]
    subprocess.run(command, check=True)
    return output_path


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": model_id,
        "warmed": model_warmed,
        "torch_device": selected_device,
        "accelerator": selected_accelerator,
        "requested_accelerator": args.device_runtime,
        "torch_hip": getattr(torch.version, "hip", None),
        "cuda_available": torch.cuda.is_available(),
        "cuda_device_count": torch.cuda.device_count(),
    }


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form("auto"),
    model_name: str = Form("", alias="model"),
) -> JSONResponse:
    if model is None:
        return JSONResponse({"error": "SenseVoice model is not loaded"}, status_code=503)

    requested_model = normalize_model_id(model_name)
    if requested_model != model_id:
        return JSONResponse(
            {
                "error": (
                    f"Loaded model is {model_id}; requested {requested_model}. "
                    "Restart scripts/sensevoice-local-server.ps1 with -ModelId to switch models."
                )
            },
            status_code=400,
        )

    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"
    with tempfile.TemporaryDirectory(prefix="bingo-sensevoice-") as temp_dir:
        raw_path = Path(temp_dir) / f"input{suffix}"
        raw_path.write_bytes(await audio.read())
        wav_path = raw_path if raw_path.suffix.lower() == ".wav" else convert_to_wav(raw_path)

        result = model.generate(
            input=str(wav_path),
            cache={},
            language=normalize_language(language),
            use_itn=True,
            batch_size_s=60,
            merge_vad=True,
            merge_length_s=15,
        )

    return JSONResponse({"text": clean_text(result), "raw": result})


def main() -> None:
    global args, model, selected_device, selected_accelerator, model_id

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.environ.get("SENSEVOICE_MODEL", "iic/SenseVoiceSmall"))
    parser.add_argument("--vad-model", default=os.environ.get("SENSEVOICE_VAD_MODEL", "fsmn-vad"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SENSEVOICE_PORT", "50001")))
    parser.add_argument("--device", default=os.environ.get("SENSEVOICE_DEVICE", "auto"))
    parser.add_argument("--host", default=os.environ.get("SENSEVOICE_HOST", "0.0.0.0"))
    args = parser.parse_args()

    model_id = normalize_model_id(args.model)
    selected_device, args.device_runtime = select_device(args.device)
    selected_accelerator = args.device_runtime
    print(
        json.dumps(
            {
                "event": "sensevoice_start",
                "model": model_id,
                "requested_device": args.device,
                "torch_device": selected_device,
                "accelerator": args.device_runtime,
                "cuda_available": torch.cuda.is_available(),
                "torch_hip": getattr(torch.version, "hip", None),
                "cuda_device_count": torch.cuda.device_count(),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    model = AutoModel(
        model=model_id,
        vad_model=args.vad_model,
        device=selected_device,
        disable_update=True,
    )

    # 模型预热：跑一次短静音推理，让 CUDA kernel 完成编译和缓存加载
    global model_warmed
    warmup_dir = tempfile.mkdtemp(prefix="bingo-sensevoice-warmup-")
    try:
        import struct
        import wave as wave_module

        warmup_wav = Path(warmup_dir) / "silence.wav"
        sample_rate = 16000
        duration_ms = 500
        num_samples = sample_rate * duration_ms // 1000
        with wave_module.open(str(warmup_wav), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            silence_frames = struct.pack("<" + "h" * num_samples, *([0] * num_samples))
            wav_file.writeframes(silence_frames)

        print(
            json.dumps({"event": "sensevoice_warmup_start"}, ensure_ascii=False),
            flush=True,
        )
        model.generate(
            input=str(warmup_wav),
            cache={},
            language="auto",
            use_itn=True,
            batch_size_s=60,
            merge_vad=True,
            merge_length_s=15,
        )
        model_warmed = True
        print(
            json.dumps({"event": "sensevoice_warmup_done"}, ensure_ascii=False),
            flush=True,
        )
    except Exception as warmup_error:
        print(
            json.dumps(
                {"event": "sensevoice_warmup_failed", "error": str(warmup_error)},
                ensure_ascii=False,
            ),
            flush=True,
        )
    finally:
        import shutil

        shutil.rmtree(warmup_dir, ignore_errors=True)

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
