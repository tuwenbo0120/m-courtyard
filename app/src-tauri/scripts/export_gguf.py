#!/usr/bin/env python3
"""
Courtyard - Standalone GGUF export script.
Pipeline: fuse LoRA → export .gguf via mlx_lm (Llama/Mistral/Mixtral only)

The output .gguf file can be used directly with llama.cpp, LM Studio, Jan, etc.
Output: JSON lines to stdout (progress + complete/error events)
"""
import argparse
import glob
import json
import os
import subprocess
import sys

from i18n import t, init_i18n, add_lang_arg


def emit(event_type, **kwargs):
    payload = {"type": event_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def run_cli(cmd, timeout=900):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "", "Command timed out after 15 minutes"
    except FileNotFoundError as e:
        return False, "", str(e)


def resolve_model_path(model_id):
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


def find_gguf(directory):
    for pat in [
        os.path.join(directory, "*.gguf"),
        os.path.join(directory, "**", "*.gguf"),
    ]:
        files = glob.glob(pat, recursive=True)
        if files:
            return files[0]
    return None


def main():
    parser = argparse.ArgumentParser(description="Courtyard GGUF export")
    parser.add_argument("--model", required=True)
    parser.add_argument("--adapter-path", required=True)
    parser.add_argument("--output-dir", required=True)
    add_lang_arg(parser)
    args = parser.parse_args()

    init_i18n(args.lang)

    try:
        _run(args)
    except Exception:
        import traceback
        emit("error", message=f"Unexpected crash: {traceback.format_exc()[-800:]}")
        sys.exit(1)


def _run(args):
    emit("progress", step="check", desc=t("gguf.starting"))

    # Resolve model path
    resolved = resolve_model_path(args.model)
    if resolved is None:
        emit("error", message=t("export.model_not_found", model=args.model))
        sys.exit(1)
    emit("progress", step="resolve", desc=f"Model: {resolved}")

    # Validate adapter
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
         desc=f"Adapter: {args.adapter_path} ({len(adapter_files)} weight file(s))")

    os.makedirs(args.output_dir, exist_ok=True)

    # Run mlx_lm.fuse --export-gguf --dequantize
    emit("progress", step="fuse", desc=t("gguf.fusing"))
    cmd = [
        sys.executable, "-m", "mlx_lm.fuse",
        "--model", resolved,
        "--adapter-path", args.adapter_path,
        "--save-path", args.output_dir,
        "--export-gguf",
        "--dequantize",
    ]
    ok, _stdout, stderr = run_cli(cmd, timeout=900)

    if not ok:
        emit("error", message=t("gguf.fuse_fail", error=(stderr or "Unknown error")[-600:]))
        sys.exit(1)

    gguf_path = find_gguf(args.output_dir)
    if not gguf_path:
        emit("error", message=t("gguf.no_output"))
        sys.exit(1)

    size_mb = round(os.path.getsize(gguf_path) / 1024 / 1024, 1)
    emit("progress", step="fuse", desc=t("gguf.done", filename=os.path.basename(gguf_path), size_mb=size_mb))
    emit("complete",
         gguf_path=gguf_path,
         filename=os.path.basename(gguf_path),
         size_mb=size_mb,
         output_dir=args.output_dir)


if __name__ == "__main__":
    main()
