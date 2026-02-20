#!/usr/bin/env python3
"""
Courtyard - Ollama export script.
Pipeline: fuse LoRA → dequantize (MLX API) → clean safetensors → ollama create

Ollama's safetensors parser (reader_safetensors.go) only supports:
  F32, F16, BF16, U8 dtypes.  Everything else → "unknown data type" error.

Strategy:
  1) Try mlx_lm.fuse --export-gguf --dequantize (Llama/Mistral/Mixtral → GGUF)
  2) Fallback: Use MLX Python API directly to load → fuse → dequantize → save.
     Then binary-clean safetensors to remove any non-float tensors.
  3) ollama create from GGUF or cleaned safetensors

Input:  --model <id> --adapter-path <path> --model-name <name> --quantization <q4|q8|f16>
Output: JSON lines to stdout (progress + completion)
"""
import argparse
import glob
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

from i18n import t, init_i18n, add_lang_arg

# Ollama-compatible safetensors dtypes (from reader_safetensors.go)
OLLAMA_OK_DTYPES = {"F32", "F16", "BF16", "U8"}


def emit(event_type, **kwargs):
    payload = {"type": event_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def check_ollama():
    """Check if Ollama is installed and running."""
    try:
        result = subprocess.run(
            ["ollama", "list"], capture_output=True, text=True, timeout=10
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def resolve_model_path(model_id):
    """Resolve HuggingFace model ID to local cache path if available."""
    if model_id.startswith(("/", "~", ".")):
        expanded = os.path.expanduser(model_id)
        return expanded if os.path.isdir(expanded) else None
    cache_dir = os.path.expanduser("~/.cache/huggingface/hub")
    safe_name = "models--" + model_id.replace("/", "--")
    model_cache = os.path.join(cache_dir, safe_name)
    if os.path.isdir(model_cache):
        snapshots = os.path.join(model_cache, "snapshots")
        if os.path.isdir(snapshots):
            versions = sorted(os.listdir(snapshots))
            if versions:
                return os.path.join(snapshots, versions[-1])
    return model_id


def run_cli(cmd, timeout=600):
    """Run a CLI command, return (success, stdout, stderr)."""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "", "Command timed out"
    except FileNotFoundError as e:
        return False, "", str(e)


def _find_gguf(directory):
    """Find .gguf files in a directory."""
    for pat in [
        os.path.join(directory, "*.gguf"),
        os.path.join(directory, "**", "*.gguf"),
    ]:
        files = glob.glob(pat, recursive=True)
        if files:
            return files[0]
    return None


# ---------------------------------------------------------------------------
# Direct MLX Python API: load → fuse → dequantize → save
# ---------------------------------------------------------------------------
def fuse_and_dequantize_direct(model_path, adapter_path, output_path):
    """Use MLX Python API to fuse adapter and dequantize in-process.

    This bypasses the CLI subprocess and guarantees proper dequantization.
    After this function, all weight tensors should be float (BF16/F16/F32).
    """
    from pathlib import Path

    from mlx.utils import tree_unflatten
    from mlx_lm.utils import dequantize_model, load, save

    emit("progress", step="fuse", desc=t("export.loading_mlx"))

    # Handle both old and new mlx_lm API (return_config added in newer versions)
    try:
        result = load(model_path, adapter_path=adapter_path, return_config=True)
        model, tokenizer, config = result
    except TypeError:
        model, tokenizer = load(model_path, adapter_path=adapter_path)
        config_file = os.path.join(model_path, "config.json")
        with open(config_file, "r") as f:
            config = json.load(f)

    # Fuse LoRA layers (with per-layer dequantize)
    emit("progress", step="fuse", desc=t("export.fusing_lora"))
    fused_linears = [
        (n, m.fuse(dequantize=True))
        for n, m in model.named_modules()
        if hasattr(m, "fuse")
    ]
    if fused_linears:
        model.update_modules(tree_unflatten(fused_linears))
        emit("progress", step="fuse", desc=t("export.fused_count", count=len(fused_linears)))

    # Dequantize ALL remaining quantized layers
    emit("progress", step="fuse", desc=t("export.dequantizing"))
    model = dequantize_model(model)
    config.pop("quantization", None)
    config.pop("quantization_config", None)

    # Ensure 'architectures' field is present (Ollama needs it to detect model type)
    if "architectures" not in config:
        # Try to infer from model_type
        arch_map = {
            "qwen2": "Qwen2ForCausalLM",
            "llama": "LlamaForCausalLM",
            "mistral": "MistralForCausalLM",
            "gemma": "GemmaForCausalLM",
            "gemma2": "Gemma2ForCausalLM",
            "phi3": "Phi3ForCausalLM",
        }
        mt = config.get("model_type", "")
        if mt in arch_map:
            config["architectures"] = [arch_map[mt]]
            emit("progress", step="fuse", desc=t("export.added_arch", arch=arch_map[mt]))

    # Save using mlx_lm's save (handles tokenizer, config, weights)
    save_path = Path(output_path)
    emit("progress", step="fuse", desc=t("export.saving"))
    save(save_path, model_path, model, tokenizer, config, donate_model=False)

    return output_path, "safetensors"


# ---------------------------------------------------------------------------
# Binary-level safetensors cleaner (safety net)
# ---------------------------------------------------------------------------
def clean_safetensors_for_ollama(model_dir):
    """Remove ALL non-float tensors from safetensors files.

    Works at binary level to preserve BF16/F16/F32 data byte-for-byte.
    Removes any tensor whose dtype is NOT in {F32, F16, BF16, U8}.
    This catches any leftover quantization artifacts regardless of name.

    Returns (kept_count, removed_count).
    """
    # If a consolidated model.safetensors exists, stale shard files from older
    # export attempts must be removed, otherwise Ollama import may see duplicate
    # tensor names when converting to GGUF.
    merged_file = os.path.join(model_dir, "model.safetensors")
    shard_files = sorted(glob.glob(os.path.join(model_dir, "model-*-of-*.safetensors")))
    if os.path.isfile(merged_file) and shard_files:
        for fp in shard_files:
            try:
                os.remove(fp)
            except OSError:
                pass
        shard_index = os.path.join(model_dir, "model.safetensors.index.json")
        if os.path.isfile(shard_index):
            try:
                os.remove(shard_index)
            except OSError:
                pass

    st_files = sorted(glob.glob(os.path.join(model_dir, "*.safetensors")))
    if not st_files:
        return 0, 0

    total_removed = 0
    total_kept = 0
    seen_tensor_names = set()

    for fpath in st_files:
        with open(fpath, "rb") as f:
            raw = f.read()

        header_size = struct.unpack("<Q", raw[:8])[0]
        header_json = raw[8 : 8 + header_size]
        data_start = 8 + header_size
        header = json.loads(header_json)

        metadata = header.pop("__metadata__", None)

        # Identify tensors with unsupported dtypes
        to_remove = set()
        for name, meta in header.items():
            if meta.get("dtype", "") not in OLLAMA_OK_DTYPES:
                to_remove.add(name)
                continue
            if name in seen_tensor_names:
                to_remove.add(name)

        if not to_remove:
            total_kept += len(header)
            seen_tensor_names.update(header.keys())
            continue

        # Rebuild file keeping only Ollama-compatible tensors
        kept = {}
        new_data = bytearray()
        for name in sorted(header.keys()):
            if name in to_remove:
                total_removed += 1
                continue
            meta = header[name]
            offsets = meta["data_offsets"]
            chunk = raw[data_start + offsets[0] : data_start + offsets[1]]
            start = len(new_data)
            new_data.extend(chunk)
            kept[name] = {
                "dtype": meta["dtype"],
                "shape": meta["shape"],
                "data_offsets": [start, len(new_data)],
            }
            total_kept += 1
            seen_tensor_names.add(name)

        if not kept:
            # This shard became empty after filtering unsupported/duplicate tensors.
            try:
                os.remove(fpath)
            except OSError:
                pass
            continue

        if metadata is not None:
            kept["__metadata__"] = metadata
        hdr_bytes = json.dumps(kept, ensure_ascii=False).encode("utf-8")

        with open(fpath, "wb") as f:
            f.write(struct.pack("<Q", len(hdr_bytes)))
            f.write(hdr_bytes)
            f.write(new_data)

    return total_kept, total_removed


def clean_config_for_ollama(model_dir):
    """Remove MLX quantization config fields from config.json."""
    config_path = os.path.join(model_dir, "config.json")
    if not os.path.exists(config_path):
        return False

    with open(config_path, "r") as f:
        config = json.load(f)

    keys_to_remove = ["quantization_config", "quantization", "quantize"]
    changed = False
    for key in keys_to_remove:
        if key in config:
            del config[key]
            changed = True

    if changed:
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)

    return changed


# ---------------------------------------------------------------------------
# Step A: Try GGUF export via CLI (Llama/Mistral/Mixtral only)
# ---------------------------------------------------------------------------
def try_gguf_export(model_path, adapter_path, output_path):
    """Try mlx_lm.fuse --export-gguf --dequantize (only works for Llama family)."""
    base_cmd = [
        sys.executable, "-m", "mlx_lm.fuse",
        "--model", model_path,
        "--adapter-path", adapter_path,
        "--save-path", output_path,
    ]
    emit("progress", step="fuse", desc=t("export.gguf_try"))
    ok, _, _ = run_cli(base_cmd + ["--export-gguf", "--dequantize"])
    if ok:
        gguf = _find_gguf(output_path)
        if gguf:
            emit("progress", step="fuse", desc=t("export.gguf_ok", filename=os.path.basename(gguf)))
            return gguf, "gguf"
    return None, None


# ---------------------------------------------------------------------------
# Step B: Create Ollama model
# ---------------------------------------------------------------------------
def create_ollama_model(model_name, model_path, model_format, quantization="q4"):
    """Create an Ollama model from a GGUF file or safetensors directory."""
    quant_map = {"q4": "q4_0", "q8": "q8_0", "f16": "f16"}
    ollama_quant = quant_map.get(quantization, "q4_0")

    fmt = "GGUF" if model_format == "gguf" else "safetensors"
    emit("progress", step="ollama",
         desc=t("export.creating", name=model_name, format=fmt, quant=ollama_quant))

    # Remove any stale/broken model with the same name first
    run_cli(["ollama", "rm", model_name], timeout=30)

    modelfile_content = f"FROM {model_path}\n"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".Modelfile", delete=False) as f:
        f.write(modelfile_content)
        modelfile_path = f.name

    try:
        cmd = ["ollama", "create", model_name, "-f", modelfile_path]
        if ollama_quant != "f16":
            cmd.extend(["--quantize", ollama_quant])

        emit("progress", step="ollama", desc=t("export.running_cmd", cmd=' '.join(cmd)))
        ok, stdout, stderr = run_cli(cmd, timeout=600)
        if ok:
            return True

        # If --quantize flag caused error, retry without it
        if "--quantize" in " ".join(cmd):
            emit("progress", step="ollama", desc=t("export.retry_no_quant"))
            cmd_no_q = ["ollama", "create", model_name, "-f", modelfile_path]
            ok2, _, stderr2 = run_cli(cmd_no_q, timeout=600)
            if ok2:
                return True
            stderr = stderr2 or stderr

        return False, stderr
    except Exception as e:
        return False, str(e)
    finally:
        try:
            os.unlink(modelfile_path)
        except OSError:
            pass


def verify_ollama_model_runtime(model_name):
    """Run a short runtime smoke test to ensure the created model is loadable."""
    prompts = [
        "Reply with exactly one word: OK",
        "Say OK",
    ]
    last_error = ""

    for prompt in prompts:
        ok, stdout, stderr = run_cli(
            ["ollama", "run", "--nowordwrap", model_name, prompt], timeout=45
        )
        text = (stdout or "").strip()
        if ok:
            return True, text[:120] if text else "(model loaded; empty response)"

        last_error = (stderr or stdout or "Model returned no output").strip()
        # Load errors are deterministic; no need to keep retrying prompts.
        if "unable to load model" in last_error.lower():
            break

    return False, last_error


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Courtyard Ollama export")
    parser.add_argument("--model", required=True)
    parser.add_argument("--adapter-path", required=True)
    parser.add_argument("--model-name", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--quantization", default="q4", choices=["q4", "q8", "f16"])
    parser.add_argument("--ollama-models-dir", default="")
    add_lang_arg(parser)
    args = parser.parse_args()

    init_i18n(args.lang)

    try:
        _run(args)
    except Exception as exc:
        import traceback
        emit("error", message=f"Unexpected crash: {traceback.format_exc()[-800:]}")
        sys.exit(1)


def _run(args):
    # Step 1: signal start (Ollama availability already verified by the frontend)
    emit("progress", step="check", desc="Starting export pipeline")

    # Step 2: Resolve paths
    resolved = resolve_model_path(args.model)
    if resolved is None:
        emit("error", message=t("export.model_not_found", model=args.model))
        sys.exit(1)
    emit("progress", step="resolve", desc=f"Model: {resolved}")

    if not os.path.isdir(args.adapter_path):
        emit("error", message=t("export.adapter_not_found", path=args.adapter_path))
        sys.exit(1)
    adapter_files = [
        f for f in os.listdir(args.adapter_path)
        if f.endswith(".safetensors") or f.endswith(".npz")
    ]
    if not adapter_files:
        emit("error", message=t("export.no_adapter_weights", path=args.adapter_path))
        sys.exit(1)
    emit("progress", step="resolve",
         desc=f"Adapter: {args.adapter_path} ({len(adapter_files)} weight files)")

    fused_dir = os.path.join(args.output_dir, "fused")
    if os.path.isdir(fused_dir):
        # The export target directory is reused per project. Clean it first so
        # stale files from previous runs cannot pollute the current export.
        shutil.rmtree(fused_dir, ignore_errors=True)
    os.makedirs(fused_dir, exist_ok=True)

    # Step 3: Try GGUF export first (fast path for Llama/Mistral/Mixtral)
    emit("progress", step="fuse",
         desc=t("export.fuse_start", model=resolved, adapter=args.adapter_path))

    model_output, model_format = try_gguf_export(resolved, args.adapter_path, fused_dir)

    # Step 3b: If GGUF failed, use direct MLX API (works for ALL architectures)
    if model_output is None:
        emit("progress", step="fuse",
             desc=t("export.gguf_fallback"))
        try:
            model_output, model_format = fuse_and_dequantize_direct(
                resolved, args.adapter_path, fused_dir
            )
        except Exception as e:
            emit("error", message=t("export.fuse_fail", error=str(e)[-600:]))
            sys.exit(1)

    # Step 3.5: Binary safety net — remove any non-float tensors from safetensors
    # Even after proper dequantization, some edge cases may leave U32/I32 artifacts.
    if model_format == "safetensors":
        emit("progress", step="convert",
             desc=t("export.verify_start"))
        try:
            kept, removed = clean_safetensors_for_ollama(model_output)
            config_cleaned = clean_config_for_ollama(model_output)
            parts = []
            if removed:
                parts.append(t("export.removed_tensors", count=removed))
            parts.append(t("export.tensors_ready", count=kept))
            if config_cleaned:
                parts.append(t("export.config_cleaned"))
            emit("progress", step="convert", desc=t("export.verify_done", details='; '.join(parts)))
        except Exception as e:
            emit("progress", step="convert",
                 desc=t("export.verify_warn", error=str(e)))

    emit("progress", step="fuse_done",
         desc=t("export.model_ready", format=model_format, filename=os.path.basename(model_output)))

    # Step 4: Create Ollama model
    result = create_ollama_model(
        args.model_name, model_output, model_format, args.quantization
    )

    if result is True:
        emit("progress", step="verify", desc=t("export.runtime_verify"))
        ok, verify_info = verify_ollama_model_runtime(args.model_name)
        if not ok:
            emit("error", message=t("export.create_fail", error=t("export.runtime_verify_fail", error=verify_info[-500:])) )
            sys.exit(1)

        # Use the daemon-aware path resolved by Rust when provided.
        ollama_models = (args.ollama_models_dir or "").strip() or os.environ.get(
            "OLLAMA_MODELS",
            os.path.expanduser("~/.ollama/models")
        )
        ollama_models = os.path.abspath(os.path.expanduser(ollama_models))
        manifest_dir = os.path.join(
            ollama_models, "manifests", "registry.ollama.ai", "library", args.model_name
        )
        emit("complete",
             model_name=args.model_name,
             output_dir=model_output,
             ollama_dir=ollama_models,
             manifest_dir=manifest_dir)
    elif isinstance(result, tuple):
        _, stderr = result
        emit("error",
             message=t("export.create_fail", error=(stderr or '')[-600:] or 'Unknown error'))
        sys.exit(1)
    else:
        emit("error", message=t("export.create_fail_unknown"))
        sys.exit(1)


if __name__ == "__main__":
    main()

