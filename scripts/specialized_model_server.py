from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

PORT = int(os.environ.get("BINGO_SPECIALIZED_MODEL_PORT", "50004"))
MODEL_IDS = {
    "pp-ocrv6-medium",
    "pp-structure-v3",
    "melotts-zh",
    "bge-small-zh-v1.5",
}
STATE_PATH = Path(os.environ.get("BINGO_SPECIALIZED_MODEL_STATE", "dev/SpecializedModels/installed-models.json"))

app = FastAPI(title="BinGO Specialized Models")
loaded: dict[str, Any] = {}
errors: dict[str, str] = {}


def installed_models() -> set[str]:
    try:
        value = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return {item for item in value if item in MODEL_IDS}
    except Exception:
        return set()


def mark_installed(model_id: str) -> None:
    values = installed_models()
    values.add(model_id)
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(sorted(values), ensure_ascii=False, indent=2), encoding="utf-8")


class InstallRequest(BaseModel):
    model_id: str


class EmbedRequest(BaseModel):
    texts: list[str]


def load_model(model_id: str) -> Any:
    if model_id in loaded:
        return loaded[model_id]
    if model_id not in MODEL_IDS:
        raise ValueError(f"Unsupported specialized model: {model_id}")
    try:
        if model_id == "pp-ocrv6-medium":
            from paddleocr import PaddleOCR

            model = PaddleOCR(
                ocr_version="PP-OCRv6",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
        elif model_id == "pp-structure-v3":
            from paddleocr import PPStructureV3

            model = PPStructureV3(
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
            )
        elif model_id == "melotts-zh":
            from melo.api import TTS

            model = TTS(language="ZH", device="cpu")
        else:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer("BAAI/bge-small-zh-v1.5", device="cpu")
        loaded[model_id] = model
        mark_installed(model_id)
        errors.pop(model_id, None)
        return model
    except Exception as error:
        errors[model_id] = str(error)
        raise


def serialize_result(result: Any) -> Any:
    value = getattr(result, "json", None)
    if callable(value):
        value = value()
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {"text": value}
    if value is not None:
        return value
    if isinstance(result, (dict, list, str, int, float, bool)) or result is None:
        return result
    return {"text": str(result)}


def collect_text(value: Any) -> list[str]:
    output: list[str] = []
    if isinstance(value, str):
        if value.strip():
            output.append(value.strip())
    elif isinstance(value, list):
        for item in value:
            output.extend(collect_text(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in {"rec_texts", "text", "markdown", "markdown_texts", "content"}:
                output.extend(collect_text(item))
            elif isinstance(item, (dict, list)):
                output.extend(collect_text(item))
    return output


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "port": PORT, "loaded": sorted(loaded), "errors": errors}


@app.get("/models")
def models() -> dict[str, Any]:
    return {
        "available": sorted(MODEL_IDS),
        "installed": sorted(installed_models()),
        "loaded": sorted(loaded),
        "errors": errors,
    }


@app.post("/models/install")
def install(request: InstallRequest) -> dict[str, Any]:
    try:
        load_model(request.model_id)
        return {"success": True, "model_id": request.model_id, "loaded": True}
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


async def save_upload(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "input.png").suffix or ".png"
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        handle.write(await upload.read())
    finally:
        handle.close()
    return Path(handle.name)


@app.post("/ocr")
async def ocr(file: UploadFile = File(...)) -> dict[str, Any]:
    path = await save_upload(file)
    try:
        model = load_model("pp-ocrv6-medium")
        raw = [serialize_result(result) for result in model.predict(str(path))]
        return {"text": "\n".join(dict.fromkeys(collect_text(raw))), "results": raw}
    finally:
        path.unlink(missing_ok=True)


@app.post("/document")
async def document(file: UploadFile = File(...)) -> dict[str, Any]:
    path = await save_upload(file)
    try:
        model = load_model("pp-structure-v3")
        raw = [serialize_result(result) for result in model.predict(str(path))]
        return {"text": "\n".join(dict.fromkeys(collect_text(raw))), "results": raw}
    finally:
        path.unlink(missing_ok=True)


@app.post("/tts")
def tts(text: str = Form(...), speed: float = Form(1.0)) -> FileResponse:
    model = load_model("melotts-zh")
    speakers = model.hps.data.spk2id
    speaker = speakers.get("ZH") or next(iter(speakers.values()))
    output = Path(tempfile.mkstemp(suffix=".wav")[1])
    model.tts_to_file(text, speaker, str(output), speed=speed)
    return FileResponse(output, media_type="audio/wav", filename="bingo-melotts.wav")


@app.post("/embeddings")
def embeddings(request: EmbedRequest) -> dict[str, Any]:
    model = load_model("bge-small-zh-v1.5")
    vectors = model.encode(request.texts, normalize_embeddings=True)
    return {"model": "BAAI/bge-small-zh-v1.5", "data": vectors.tolist()}
