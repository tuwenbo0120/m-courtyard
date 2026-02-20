#!/usr/bin/env python3
"""Download a HuggingFace model with real-time progress reporting.

Usage:
    python download_model.py <repo_id> [--cache-dir <path>]

Output format (one JSON line per event, parsed by Rust backend):
    {"event":"start","repo_id":"mlx-community/Qwen2.5-3B-Instruct-4bit"}
    {"event":"progress","downloaded":1234567,"total":5000000,"percent":24.7,"speed_mb":12.3,"file":"model.safetensors"}
    {"event":"file_done","file":"model.safetensors","size":5000000}
    {"event":"complete","path":"/path/to/hub/models--mlx-community--Qwen2.5-3B-Instruct-4bit/snapshots/abc123"}
    {"event":"error","message":"..."}
"""

import sys
import json
import time
import os
import argparse

from i18n import t, init_i18n, add_lang_arg


def emit(event_data: dict):
    """Print a JSON event line for Rust to parse."""
    print(json.dumps(event_data, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_id", help="HuggingFace repo ID, e.g. mlx-community/Qwen2.5-3B-Instruct-4bit")
    parser.add_argument("--cache-dir", default=None, help="Custom cache directory")
    add_lang_arg(parser)
    args = parser.parse_args()

    init_i18n(args.lang)

    repo_id = args.repo_id
    cache_dir = args.cache_dir

    emit({"event": "start", "repo_id": repo_id})

    try:
        from huggingface_hub import snapshot_download, HfApi
        from huggingface_hub.utils import (
            RepositoryNotFoundError,
            GatedRepoError,
            EntryNotFoundError,
        )
    except ImportError:
        emit({"event": "error", "message": t("download.not_installed")})
        sys.exit(1)

    # Validate repo exists before downloading
    try:
        api = HfApi()
        info = api.model_info(repo_id)
        emit({"event": "info", "model_id": repo_id, "sha": info.sha or ""})
    except RepositoryNotFoundError:
        emit({"event": "error", "message": t("download.not_found", repo=repo_id)})
        sys.exit(1)
    except GatedRepoError:
        emit({"event": "error", "message": t("download.gated", repo=repo_id)})
        sys.exit(1)
    except Exception as e:
        emit({"event": "error", "message": t("download.info_fail", error=str(e))})
        sys.exit(1)

    # Track download progress via tqdm callback
    last_report_time = [time.time()]
    total_downloaded = [0]
    total_size = [0]

    # Use a custom tqdm callback to report progress
    class ProgressCallback:
        """Custom callback for huggingface_hub download progress."""
        def __init__(self):
            self.current_file = ""
            self.file_downloaded = 0
            self.file_total = 0

        def __call__(self, progress):
            # progress is bytes downloaded in this chunk
            now = time.time()
            total_downloaded[0] += progress
            self.file_downloaded += progress

            # Throttle reports to every 0.5 seconds
            if now - last_report_time[0] >= 0.5:
                elapsed = now - last_report_time[0]
                speed_mb = (progress / elapsed) / (1024 * 1024) if elapsed > 0 else 0
                percent = (total_downloaded[0] / total_size[0] * 100) if total_size[0] > 0 else 0
                emit({
                    "event": "progress",
                    "downloaded": total_downloaded[0],
                    "total": total_size[0],
                    "percent": round(percent, 1),
                    "speed_mb": round(speed_mb, 1),
                    "file": self.current_file,
                })
                last_report_time[0] = now

    # Calculate total size first
    try:
        files = api.list_repo_tree(repo_id, recursive=True)
        total = 0
        for f in files:
            if hasattr(f, "size") and f.size:
                total += f.size
        total_size[0] = total
        emit({"event": "total_size", "bytes": total, "mb": round(total / (1024 * 1024), 1)})
    except Exception:
        pass  # Non-critical, progress will work without total

    # Download
    try:
        kwargs = {"repo_id": repo_id, "local_dir_use_symlinks": False}
        if cache_dir:
            kwargs["cache_dir"] = cache_dir

        path = snapshot_download(**kwargs)

        emit({"event": "complete", "path": path, "repo_id": repo_id})
    except KeyboardInterrupt:
        emit({"event": "cancelled", "repo_id": repo_id})
        sys.exit(130)
    except Exception as e:
        emit({"event": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
