from pathlib import Path
import re
import textwrap


def write_if_changed(path: Path, content: str) -> None:
    content = textwrap.dedent(content).lstrip()
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return
    path.write_text(content, encoding="utf-8")


def main() -> None:
    import mineru

    package_dir = Path(mineru.__file__).resolve().parent

    config_reader_path = package_dir / "utils" / "config_reader.py"
    config_reader_source = config_reader_path.read_text(encoding="utf-8")
    strict_device_mode_helper = r'''

def _normalize_bingo_device_mode(device_mode):
    if device_mode is None:
        return None

    normalized = str(device_mode).strip().lower()
    if normalized == "rocm":
        normalized = "cuda"
    if normalized == "cuda":
        return "cuda"
    if normalized == "cpu":
        raise RuntimeError("MINERU_DEVICE_MODE=cpu is disabled; Bingo local models require ROCm/HIP GPU.")
    raise RuntimeError(f"Unsupported MINERU_DEVICE_MODE={device_mode!r}; Bingo local models require ROCm/HIP GPU.")


def _require_bingo_rocm_device():
    import torch

    if not getattr(torch.version, "hip", None):
        raise RuntimeError(f"MinerU requires ROCm PyTorch; installed torch={torch.__version__}.")
    if not torch.cuda.is_available():
        raise RuntimeError("MinerU requires a visible ROCm/HIP GPU.")
    return "cuda"
'''
    strict_get_device = r'''
def get_device():
    device_mode = _normalize_bingo_device_mode(os.getenv('MINERU_DEVICE_MODE', None))
    if device_mode is not None:
        return device_mode
    return _require_bingo_rocm_device()
'''

    if "def _normalize_bingo_device_mode" not in config_reader_source:
        config_reader_source = config_reader_source.replace(
            "\n\ndef get_device():\n",
            f"{strict_device_mode_helper}\n\ndef get_device():\n",
        )
    else:
        config_reader_source = re.sub(
            r"\n\ndef _normalize_bingo_device_mode\(device_mode\):\n[\s\S]*?\n\ndef get_device\(\):",
            f"{strict_device_mode_helper}\n\ndef get_device():",
            config_reader_source,
            count=1,
        )
    config_reader_source = re.sub(
        r"\n\ndef get_device\(\):\n[\s\S]*?\n\ndef get_formula_enable",
        f"{strict_get_device}\n\ndef get_formula_enable",
        config_reader_source,
        count=1,
    )
    config_reader_path.write_text(config_reader_source, encoding="utf-8")

    unimernet_path = package_dir / "model" / "mfr" / "unimernet" / "Unimernet.py"
    unimernet_source = unimernet_path.read_text(encoding="utf-8")
    if 'logger.info(f"MinerU UniMERNet device: {self.device}")' not in unimernet_source:
        unimernet_source = unimernet_source.replace(
            "import torch\n",
            "import torch\nfrom loguru import logger\n",
        )
        unimernet_source = unimernet_source.replace(
            "        self.model.to(self.device)\n",
            "        self.model.to(self.device)\n"
            '        logger.info(f"MinerU UniMERNet device: {self.device}")\n',
        )
    unimernet_path.write_text(unimernet_source, encoding="utf-8")

    rec_lcnetv3_path = (
        package_dir
        / "model"
        / "utils"
        / "pytorchocr"
        / "modeling"
        / "backbones"
        / "rec_lcnetv3.py"
    )
    rec_lcnetv3_source = rec_lcnetv3_path.read_text(encoding="utf-8")
    rec_lcnetv3_source = rec_lcnetv3_source.replace(
        "        kernel, bias = self._get_kernel_bias()\n"
        "        self.reparam_conv = nn.Conv2d(\n"
        "            in_channels=self.in_channels,\n"
        "            out_channels=self.out_channels,\n"
        "            kernel_size=self.kernel_size,\n"
        "            stride=self.stride,\n"
        "            padding=self.padding,\n"
        "            groups=self.groups,\n"
        "        )\n"
        "        self.reparam_conv.weight.data = kernel\n"
        "        self.reparam_conv.bias.data = bias\n"
        "        self.is_repped = True\n",
        "        kernel, bias = self._get_kernel_bias()\n"
        "        reference = kernel if isinstance(kernel, torch.Tensor) else next(self.parameters())\n"
        "        self.reparam_conv = nn.Conv2d(\n"
        "            in_channels=self.in_channels,\n"
        "            out_channels=self.out_channels,\n"
        "            kernel_size=self.kernel_size,\n"
        "            stride=self.stride,\n"
        "            padding=self.padding,\n"
        "            groups=self.groups,\n"
        "        ).to(device=reference.device, dtype=reference.dtype)\n"
        "        self.reparam_conv.weight.data.copy_(kernel.to(device=self.reparam_conv.weight.device, dtype=self.reparam_conv.weight.dtype))\n"
        "        self.reparam_conv.bias.data.copy_(bias.to(device=self.reparam_conv.bias.device, dtype=self.reparam_conv.bias.dtype))\n"
        "        self.is_repped = True\n",
    )
    rec_lcnetv3_path.write_text(rec_lcnetv3_source, encoding="utf-8")

    formula_path = package_dir / "model" / "mfr" / "pp_formulanet_plus_m" / "predict_formula.py"
    formula_source = formula_path.read_text(encoding="utf-8")
    if 'logger.info(f"MinerU FormulaRecognizer device: {self.device}")' not in formula_source:
        formula_source = formula_source.replace(
            "from tqdm import tqdm\n",
            "from tqdm import tqdm\nfrom loguru import logger\n",
        )
        formula_source = formula_source.replace(
            "        self.net.to(self.device)\n",
            "        self.net.to(self.device)\n"
            '        logger.info(f"MinerU FormulaRecognizer device: {self.device}")\n',
        )
    formula_path.write_text(formula_source, encoding="utf-8")

    ocr_path = package_dir / "model" / "ocr" / "pytorch_paddle.py"
    ocr_source = ocr_path.read_text(encoding="utf-8")
    strict_ocr_helper = r'''

def _get_bingo_ocr_device(default_device):
    accelerator = os.getenv("BINGO_MINERU_OCR_ACCELERATOR", "").strip().lower()
    if accelerator == "cpu":
        raise RuntimeError("MinerU OCR CPU fallback is disabled; Bingo local models require ROCm/HIP GPU.")

    import torch

    if not getattr(torch.version, "hip", None):
        raise RuntimeError(f"MinerU OCR requires ROCm PyTorch; installed torch={torch.__version__}.")
    if not torch.cuda.is_available():
        raise RuntimeError("MinerU OCR requires a visible ROCm/HIP GPU.")
    if accelerator and accelerator not in {"cuda", "rocm", "auto"}:
        raise RuntimeError(f"Unsupported BINGO_MINERU_OCR_ACCELERATOR={accelerator!r}; use cuda/rocm.")
    if str(default_device).split(":", 1)[0].lower() not in {"cuda", "rocm"}:
        raise RuntimeError(f"MinerU OCR default device {default_device!r} is not GPU-backed.")
    return "cuda"
'''
    if "def _get_bingo_ocr_device" not in ocr_source:
        ocr_source = ocr_source.replace(
            "import argparse\n",
            f"import argparse\n{strict_ocr_helper}",
        )
    else:
        ocr_source = re.sub(
            r"\n\ndef _get_bingo_ocr_device\(default_device\):\n[\s\S]*?\n\nlatin_lang = \[",
            f"{strict_ocr_helper}\n\nlatin_lang = [",
            ocr_source,
            count=1,
        )
    ocr_source = ocr_source.replace(
        "        device = get_device()\n",
        "        device = _get_bingo_ocr_device(get_device())\n",
    )
    if 'logger.info(f"MinerU OCR device: {device}, lang={self.lang}")' not in ocr_source:
        ocr_source = ocr_source.replace(
            "        kwargs['device'] = device\n",
            "        kwargs['device'] = device\n"
            '        logger.info(f"MinerU OCR device: {device}, lang={self.lang}")\n',
        )
    ocr_path.write_text(ocr_source, encoding="utf-8")

    layout_path = package_dir / "model" / "layout" / "pp_doclayoutv2.py"
    layout_source = layout_path.read_text(encoding="utf-8")
    if 'logger.info(f"MinerU PPDocLayoutV2 device: {self.device}")' not in layout_source:
        layout_source = layout_source.replace(
            "from tqdm import tqdm\n",
            "from tqdm import tqdm\nfrom loguru import logger\n",
        )
        layout_source = layout_source.replace(
            "        self.model.to(self.device)\n",
            "        self.model.to(self.device)\n"
            '        logger.info(f"MinerU PPDocLayoutV2 device: {self.device}")\n',
        )
    layout_path.write_text(layout_source, encoding="utf-8")

    model_init_path = package_dir / "backend" / "pipeline" / "model_init.py"
    model_init_source = model_init_path.read_text(encoding="utf-8")
    strict_model_device_helper = r'''
def _select_bingo_model_device(model_name, default_device):
    accelerator = os.getenv(f"BINGO_MINERU_{model_name}_ACCELERATOR", "").strip().lower()
    if accelerator == "cpu":
        raise RuntimeError(f"MinerU {model_name} CPU fallback is disabled; Bingo local models require ROCm/HIP GPU.")
    if accelerator and accelerator not in {"cuda", "rocm", "auto"}:
        raise RuntimeError(f"Unsupported MinerU {model_name} accelerator {accelerator!r}; use cuda/rocm.")
    if not getattr(torch.version, "hip", None):
        raise RuntimeError(f"MinerU {model_name} requires ROCm PyTorch; installed torch={torch.__version__}.")
    if not torch.cuda.is_available():
        raise RuntimeError(f"MinerU {model_name} requires a visible ROCm/HIP GPU.")
    return "cuda"


'''
    if "def _select_bingo_model_device" not in model_init_source:
        model_init_source = model_init_source.replace(
            "MFR_MODEL = os.getenv('MINERU_FORMULA_CH_SUPPORT', 'False')\n",
            f"{strict_model_device_helper}MFR_MODEL = os.getenv('MINERU_FORMULA_CH_SUPPORT', 'False')\n",
        )
    else:
        model_init_source = re.sub(
            r"\ndef _select_bingo_model_device\(model_name, default_device\):\n[\s\S]*?\n\n\nMFR_MODEL =",
            f"\n{strict_model_device_helper}MFR_MODEL =",
            model_init_source,
            count=1,
        )
    model_init_source = model_init_source.replace(
        "def mfr_model_init(weight_dir, device='cpu'):\n"
        "    if MFR_MODEL == \"unimernet_small\":\n",
        "def mfr_model_init(weight_dir, device='cpu'):\n"
        "    device = _select_bingo_model_device(\"MFR\", device)\n"
        '    logger.info(f"MinerU MFR init device: {device}")\n'
        "    if MFR_MODEL == \"unimernet_small\":\n",
    )
    model_init_source = model_init_source.replace(
        "def pp_doclayout_v2_model_init(weight, device='cpu'):\n"
        "    if str(device).startswith('npu'):\n",
        "def pp_doclayout_v2_model_init(weight, device='cpu'):\n"
        "    device = _select_bingo_model_device(\"LAYOUT\", device)\n"
        '    logger.info(f"MinerU layout init device: {device}")\n'
        "    if str(device).startswith('npu'):\n",
    )
    model_init_path.write_text(model_init_source, encoding="utf-8")

    write_if_changed(
        package_dir / "model" / "table" / "rec" / "onnxruntime_provider.py",
        r'''
        # Copyright (c) Opendatalab. All rights reserved.
        import os
        from typing import Any, List, Sequence, Tuple

        from mineru.utils.config_reader import get_device


        CUDA_PROVIDER = "CUDAExecutionProvider"
        TENSORRT_PROVIDER = "TensorrtExecutionProvider"

        CUDA_PROVIDER_OPTS = {
            "cudnn_conv_algo_search": "HEURISTIC",
        }
        TENSORRT_PROVIDER_OPTS = {
            "trt_fp16_enable": True,
            "trt_engine_cache_enable": True,
            "trt_engine_cache_path": os.getenv("BINGO_MINERU_TRT_CACHE", ""),
        }


        def _normalize_device(device: object) -> str:
            if not isinstance(device, str):
                return ""
            return device.split(":", 1)[0].strip().lower()


        def _env_accelerator() -> str:
            return os.getenv("BINGO_MINERU_ACCELERATOR", "").strip().lower()


        def _provider(
            name: str,
            options: dict[str, Any] | None = None,
        ) -> Tuple[str, dict[str, Any]]:
            return (name, dict(options or {}))


        def _has(available_providers: Sequence[str], provider: str) -> bool:
            return provider in available_providers


        def build_table_onnx_providers(
            available_providers: Sequence[str],
        ) -> List[Tuple[str, dict[str, Any]]]:
            providers: List[Tuple[str, dict[str, Any]]] = []
            accelerator = _env_accelerator()
            device = _normalize_device(get_device())

            if accelerator in {"cuda", "rocm"} or device == "cuda":
                if _has(available_providers, TENSORRT_PROVIDER):
                    providers.append(_provider(TENSORRT_PROVIDER, TENSORRT_PROVIDER_OPTS))
                if _has(available_providers, CUDA_PROVIDER):
                    providers.append(_provider(CUDA_PROVIDER, CUDA_PROVIDER_OPTS))

            if not providers:
                raise RuntimeError(
                    "MinerU ONNX table/orientation model has no GPU execution provider. "
                    f"Available providers: {list(available_providers)}. CPU fallback is disabled."
                )

            seen: set[str] = set()
            deduped: List[Tuple[str, dict[str, Any]]] = []
            for provider in providers:
                if provider[0] in seen:
                    continue
                seen.add(provider[0])
                deduped.append(provider)
            try:
                from loguru import logger

                logger.info(f"MinerU ONNX Runtime providers: {provider_names(deduped)}")
            except Exception:
                pass
            return deduped


        def provider_names(providers: Sequence[object]) -> List[str]:
            names: List[str] = []
            for provider in providers:
                if isinstance(provider, tuple) and provider:
                    names.append(str(provider[0]))
                else:
                    names.append(str(provider))
            return names
        ''',
    )

    for relative_path in [
        Path("model") / "table" / "rec" / "slanet_plus" / "table_structure_utils.py",
        Path("model") / "table" / "rec" / "unet_table" / "utils.py",
    ]:
        path = package_dir / relative_path
        source = path.read_text(encoding="utf-8")
        source = re.sub(
            r"from \.\.onnxruntime_provider import \(\n[\s\S]*?build_table_onnx_providers,[\s\S]*?\)\n",
            "from ..onnxruntime_provider import build_table_onnx_providers\n",
            source,
            count=1,
        )
        source = source.replace(
            "from ..onnxruntime_provider import build_table_onnx_providers\n",
            "from ..onnxruntime_provider import build_table_onnx_providers\n",
        )
        source = source.replace(
            "        sess_opt = self._init_sess_opts(config)\n"
            "        self.session = InferenceSession(\n"
            "            model_path,\n"
            "            sess_options=sess_opt,\n"
            "            providers=EP_list,\n"
            "        )",
            "        sess_opt = self._init_sess_opts(config)\n"
            "        self.model_path = model_path\n"
            "        self.sess_opt = sess_opt\n"
            "        self.providers = EP_list\n"
            "        self.session = InferenceSession(\n"
            "            self.model_path,\n"
            "            sess_options=self.sess_opt,\n"
            "            providers=self.providers,\n"
            "        )",
        )
        strict_table_call = (
            "    def __call__(self, input_content: List[np.ndarray]) -> np.ndarray:\n"
            "        input_dict = dict(zip(self.get_input_names(), input_content))\n"
            "        try:\n"
            "            return self.session.run(None, input_dict)\n"
            "        except Exception as e:\n"
            "            error_info = traceback.format_exc()\n"
            "            raise ONNXRuntimeError(\n"
            "                f\"ONNX Runtime GPU provider failed for table model {self.model_path}; \"\n"
            "                f\"CPU fallback is disabled. providers={self.providers}\\\\n{error_info}\"\n"
            "            ) from e\n"
        )
        if "def _switch_to_cpu_session" in source:
            source = re.sub(
                r"    def _switch_to_cpu_session\(self\) -> bool:\n[\s\S]*?        return True\n\n",
                "",
                source,
                count=1,
            )
        source = re.sub(
            r"    def __call__\(self, input_content: List\[np\.ndarray\]\) -> np\.ndarray:\n[\s\S]*?\n    def get_input_names",
            f"{strict_table_call}\n    def get_input_names",
            source,
            count=1,
        )
        path.write_text(source, encoding="utf-8")

    for relative_path in [
        Path("model") / "ori_cls" / "paddle_ori_cls.py",
        Path("model") / "table" / "cls" / "mineru_table_ori_cls.py",
        Path("model") / "table" / "cls" / "paddle_table_cls.py",
    ]:
        path = package_dir / relative_path
        if not path.exists():
            continue
        source = path.read_text(encoding="utf-8")
        source = re.sub(
            r"from mineru\.model\.table\.rec\.onnxruntime_provider import \(\n[\s\S]*?build_table_onnx_providers,[\s\S]*?\)\n",
            "from mineru.model.table.rec.onnxruntime_provider import build_table_onnx_providers\n",
            source,
            count=1,
        )
        source = source.replace(
            "from mineru.model.table.rec.onnxruntime_provider import build_table_onnx_providers\n",
            "from mineru.model.table.rec.onnxruntime_provider import build_table_onnx_providers\n",
        )
        if relative_path.name in {"paddle_ori_cls.py", "mineru_table_ori_cls.py"} and "from loguru import logger\n" not in source:
            source = source.replace("from tqdm import tqdm\n", "from tqdm import tqdm\nfrom loguru import logger\n")
        if "build_table_onnx_providers" not in source:
            source = source.replace(
                "import onnxruntime\n",
                "import onnxruntime\nfrom onnxruntime import get_available_providers\n\n"
                "from mineru.model.table.rec.onnxruntime_provider import build_table_onnx_providers\n",
            )
        source = source.replace(
            "onnxruntime.InferenceSession(\n            os.path.join(auto_download_and_get_model_root_path(ModelPath.paddle_orientation_classification), ModelPath.paddle_orientation_classification)\n        )",
            "onnxruntime.InferenceSession(\n            os.path.join(auto_download_and_get_model_root_path(ModelPath.paddle_orientation_classification), ModelPath.paddle_orientation_classification),\n            providers=build_table_onnx_providers(get_available_providers()),\n        )",
        )
        source = source.replace(
            "onnxruntime.InferenceSession(\n            os.path.join(auto_download_and_get_model_root_path(ModelPath.paddle_table_cls), ModelPath.paddle_table_cls)\n        )",
            "onnxruntime.InferenceSession(\n            os.path.join(auto_download_and_get_model_root_path(ModelPath.paddle_table_cls), ModelPath.paddle_table_cls),\n            providers=build_table_onnx_providers(get_available_providers()),\n        )",
        )
        source = source.replace(
            "        self.sess = onnxruntime.InferenceSession(\n"
            "            os.path.join(auto_download_and_get_model_root_path(ModelPath.paddle_orientation_classification), ModelPath.paddle_orientation_classification),\n"
            "            providers=build_table_onnx_providers(get_available_providers()),\n"
            "        )",
            "        self.model_path = os.path.join(\n"
            "            auto_download_and_get_model_root_path(ModelPath.paddle_orientation_classification),\n"
            "            ModelPath.paddle_orientation_classification,\n"
            "        )\n"
            "        self.providers = build_table_onnx_providers(get_available_providers())\n"
            "        self.sess = onnxruntime.InferenceSession(\n"
            "            self.model_path,\n"
            "            providers=self.providers,\n"
            "        )",
        )
        source = source.replace(
            "        self.sess = onnxruntime.InferenceSession(\n"
            "            os.path.join(auto_download_and_get_model_root_path(ModelPath.paddle_table_cls), ModelPath.paddle_table_cls),\n"
            "            providers=build_table_onnx_providers(get_available_providers()),\n"
            "        )",
            "        self.model_path = os.path.join(\n"
            "            auto_download_and_get_model_root_path(ModelPath.paddle_table_cls),\n"
            "            ModelPath.paddle_table_cls,\n"
            "        )\n"
            "        self.providers = build_table_onnx_providers(get_available_providers())\n"
            "        self.sess = onnxruntime.InferenceSession(\n"
            "            self.model_path,\n"
            "            providers=self.providers,\n"
            "        )",
        )
        strict_cls_run_session = (
            "    def _run_session(self, input_feed):\n"
            "        try:\n"
            "            return self.sess.run(None, input_feed)\n"
            "        except Exception as error:\n"
            "            raise RuntimeError(\n"
            "                f\"ONNX Runtime GPU provider failed for {self.model_path}; \"\n"
            "                f\"CPU fallback is disabled. providers={self.providers}\"\n"
            "            ) from error\n"
        )
        if "def _run_session" in source:
            source = re.sub(
                r"    def _run_session\(self, input_feed\):\n[\s\S]*?\n\n    def preprocess\(self, input_img\):\n",
                f"{strict_cls_run_session}\n\n    def preprocess(self, input_img):\n",
                source,
                count=1,
            )
        else:
            source = source.replace("self.sess.run(None, ", "self._run_session(")
            source = source.replace(
                "    def preprocess(self, input_img):\n",
                f"{strict_cls_run_session}\n\n"
                "    def preprocess(self, input_img):\n",
            )
        path.write_text(source, encoding="utf-8")

    print(f"Patched MinerU ROCm provider selection under {package_dir}")


if __name__ == "__main__":
    main()
