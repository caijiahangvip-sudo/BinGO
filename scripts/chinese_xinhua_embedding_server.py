from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

try:
    import torch
    from transformers import AutoModel, AutoTokenizer
except Exception:  # pragma: no cover - reported by /health
    torch = None
    AutoModel = None
    AutoTokenizer = None


MODEL_ID = os.environ.get("BINGO_EMBEDDING_MODEL", "BAAI/bge-base-zh-v1.5")
PORT = int(os.environ.get("BINGO_EMBEDDING_PORT", "50003"))
DATA_ROOT = Path(os.environ.get("BINGO_CHINESE_XINHUA_DATA", "/mnt/c/Bingo/data/chinese-xinhua/data"))
INDEX_ROOT = Path(os.environ.get("BINGO_CHINESE_XINHUA_INDEX", "/mnt/c/Bingo/runtime-data/chinese-xinhua-index"))
TOP_K_DEFAULT = int(os.environ.get("BINGO_CHINESE_XINHUA_TOP_K", "8"))
REQUIRE_ROCM = os.environ.get("BINGO_REQUIRE_ROCM", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

INDEX_ROOT.mkdir(parents=True, exist_ok=True)
DB_PATH = INDEX_ROOT / "entries.sqlite"
VECTORS_PATH = INDEX_ROOT / "vectors.npy"

app = FastAPI(title="Bingo Chinese Xinhua Embedding Service")

_tokenizer = None
_model = None
_device = None
_vectors: np.ndarray | None = None
_entries: list[dict[str, Any]] | None = None
_startup_error: str | None = None


class SearchRequest(BaseModel):
    query: str
    limit: int = TOP_K_DEFAULT


class EmbedRequest(BaseModel):
    texts: list[str]


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def read_json_array(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return data if isinstance(data, list) else []


def iter_entries() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    for item in read_json_array(DATA_ROOT / "word.json"):
        key = normalize_text(str(item.get("word") or ""))
        if key:
            text = normalize_text(
                f"{key} {item.get('pinyin') or ''} {item.get('explanation') or ''} {item.get('more') or ''}"
            )
            rows.append({"type": "character", "key": key, "text": text})

    for item in read_json_array(DATA_ROOT / "ci.json"):
        key = normalize_text(str(item.get("ci") or ""))
        if key:
            text = normalize_text(f"{key} {item.get('explanation') or ''}")
            rows.append({"type": "word", "key": key, "text": text})

    for item in read_json_array(DATA_ROOT / "idiom.json"):
        key = normalize_text(str(item.get("word") or ""))
        if key:
            text = normalize_text(
                f"{key} {item.get('pinyin') or ''} {item.get('explanation') or ''} {item.get('derivation') or ''} {item.get('example') or ''}"
            )
            rows.append({"type": "idiom", "key": key, "text": text})

    for item in read_json_array(DATA_ROOT / "xiehouyu.json"):
        key = normalize_text(str(item.get("riddle") or ""))
        if key:
            text = normalize_text(f"{key} {item.get('answer') or ''}")
            rows.append({"type": "xiehouyu", "key": key, "text": text})

    return rows


def choose_device() -> str:
    if torch is None:
        raise RuntimeError("PyTorch is not installed in the WSL embedding environment.")
    if not getattr(torch.version, "hip", None):
        if REQUIRE_ROCM:
            raise RuntimeError(
                f"Embedding service requires ROCm PyTorch; installed torch={torch.__version__}."
            )
        raise RuntimeError("Embedding service is not running on ROCm PyTorch.")
    if not torch.cuda.is_available():
        raise RuntimeError("Embedding service requires a visible ROCm/HIP GPU.")
    return "cuda"


def load_model() -> None:
    global _tokenizer, _model, _device
    if _model is not None and _tokenizer is not None:
        return
    if AutoTokenizer is None or AutoModel is None:
        raise RuntimeError("transformers is not installed in the WSL embedding environment.")
    _device = choose_device()
    _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    _model = AutoModel.from_pretrained(MODEL_ID)
    _model.to(_device)
    _model.eval()


def embed_texts(texts: list[str], batch_size: int = 64) -> np.ndarray:
    load_model()
    assert _tokenizer is not None and _model is not None and _device is not None
    vectors: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            batch = texts[start:start + batch_size]
            encoded = _tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            encoded = {key: value.to(_device) for key, value in encoded.items()}
            output = _model(**encoded)
            pooled = output.last_hidden_state[:, 0]
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            vectors.append(pooled.detach().cpu().numpy().astype("float32"))
    return np.vstack(vectors) if vectors else np.zeros((0, 512), dtype="float32")


def save_entries(entries: list[dict[str, Any]]) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DROP TABLE IF EXISTS entries")
        conn.execute("CREATE TABLE entries (id INTEGER PRIMARY KEY, type TEXT, key TEXT, text TEXT)")
        conn.executemany(
            "INSERT INTO entries (id, type, key, text) VALUES (?, ?, ?, ?)",
            [(idx, item["type"], item["key"], item["text"]) for idx, item in enumerate(entries)],
        )
        conn.commit()


def load_entries_from_db() -> list[dict[str, Any]]:
    if not DB_PATH.exists():
        return []
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT id, type, key, text FROM entries ORDER BY id").fetchall()
    return [{"id": row[0], "type": row[1], "key": row[2], "text": row[3]} for row in rows]


def ensure_index() -> None:
    global _entries, _vectors
    if _entries is not None and _vectors is not None:
        return

    if DB_PATH.exists() and VECTORS_PATH.exists():
        _entries = load_entries_from_db()
        _vectors = np.load(VECTORS_PATH, mmap_mode="r")
        return

    entries = iter_entries()
    texts = [entry["text"] for entry in entries]
    vectors = embed_texts(texts)
    save_entries(entries)
    np.save(VECTORS_PATH, vectors)
    _entries = entries
    _vectors = vectors


@app.on_event("startup")
def startup() -> None:
    global _startup_error
    try:
        load_model()
    except Exception as exc:
        _startup_error = str(exc)


@app.get("/health")
def health() -> dict[str, Any]:
    torch_hip = getattr(getattr(torch, "version", None), "hip", None) if torch is not None else None
    cuda_available = bool(torch is not None and torch.cuda.is_available())
    cuda_device_count = int(torch.cuda.device_count()) if torch is not None else 0
    cuda_devices: list[str] = []
    if torch is not None and cuda_device_count > 0:
        for index in range(cuda_device_count):
            try:
                cuda_devices.append(torch.cuda.get_device_name(index))
            except Exception:
                cuda_devices.append(f"cuda:{index}")

    return {
        "ok": _startup_error is None,
        "model": MODEL_ID,
        "device": _device,
        "torch": getattr(torch, "__version__", None) if torch is not None else None,
        "torchHip": torch_hip,
        "cudaAvailable": cuda_available,
        "cudaDeviceCount": cuda_device_count,
        "cudaDevices": cuda_devices,
        "dataRoot": str(DATA_ROOT),
        "indexRoot": str(INDEX_ROOT),
        "indexed": DB_PATH.exists() and VECTORS_PATH.exists(),
        "startupError": _startup_error,
    }


@app.post("/embed")
def embed(request: EmbedRequest) -> dict[str, Any]:
    vectors = embed_texts([normalize_text(text) for text in request.texts])
    return {"vectors": vectors.tolist(), "model": MODEL_ID, "device": _device}


@app.post("/search")
def search(request: SearchRequest) -> dict[str, Any]:
    started = time.time()
    ensure_index()
    assert _entries is not None and _vectors is not None

    query_vector = embed_texts([request.query])[0]
    scores = np.asarray(_vectors @ query_vector)
    limit = max(1, min(int(request.limit or TOP_K_DEFAULT), 30))
    top_indices = np.argpartition(-scores, min(limit, len(scores) - 1))[:limit]
    top_indices = top_indices[np.argsort(-scores[top_indices])]
    results = [
        {
            "score": float(scores[index]),
            "type": _entries[int(index)]["type"],
            "key": _entries[int(index)]["key"],
            "text": _entries[int(index)]["text"],
        }
        for index in top_indices
    ]
    return {
        "results": results,
        "model": MODEL_ID,
        "device": _device,
        "elapsedMs": round((time.time() - started) * 1000),
    }
