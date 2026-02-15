#!/usr/bin/env python3
"""
Courtyard - Data cleaning script.
One-click cleaning pipeline: encoding fix, dedup, noise removal, segmentation.
Input:  --project-dir <path>
Output: cleaned files in <project-dir>/cleaned/
Progress: JSON lines to stdout
"""
import argparse
import json
import os
import re
import hashlib
import sys
import time

from i18n import t, init_i18n, add_lang_arg


def emit(event_type, **kwargs):
    """Emit a JSON event line to stdout for Rust to parse."""
    payload = {"type": event_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def fix_encoding(text):
    """Try to fix common encoding issues."""
    # Already decoded as UTF-8 by Python open(), just clean surrogates
    return text.encode("utf-8", errors="replace").decode("utf-8")


def remove_noise(text):
    """Remove common noise patterns."""
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Remove URLs
    text = re.sub(r"https?://\S+", "", text)
    # Remove excessive whitespace
    text = re.sub(r"[ \t]+", " ", text)
    # Remove excessive newlines (3+ -> 2)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Strip lines
    lines = [line.strip() for line in text.split("\n")]
    return "\n".join(lines)


def dedup_paragraphs(paragraphs):
    """Remove exact duplicate paragraphs."""
    seen = set()
    unique = []
    for p in paragraphs:
        h = hashlib.md5(p.strip().encode()).hexdigest()
        if h not in seen and len(p.strip()) > 0:
            seen.add(h)
            unique.append(p)
    return unique


def filter_short(paragraphs, min_chars=20):
    """Remove paragraphs shorter than min_chars."""
    return [p for p in paragraphs if len(p.strip()) >= min_chars]


def smart_segment(text, max_tokens=1024):
    """Split text into segments roughly by paragraph, respecting max token estimate."""
    # Rough estimate: 1 token ≈ 1.5 chars for Chinese, 4 chars for English
    avg_char_per_token = 2.5
    max_chars = int(max_tokens * avg_char_per_token)

    paragraphs = text.split("\n\n")
    segments = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) > max_chars and current:
            segments.append(current.strip())
            current = para
        else:
            current = current + "\n\n" + para if current else para

    if current.strip():
        segments.append(current.strip())

    return segments


MARKDOWN_EXTS = {".md", ".markdown"}
CODE_EXTS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
    ".go", ".rs", ".swift", ".kt", ".sql", ".sh", ".bash", ".zsh",
}
STRUCTURED_EXTS = {".json", ".jsonl", ".csv", ".tsv", ".xml", ".yaml", ".yml"}


def _max_chars(max_tokens=1024):
    return int(max_tokens * 2.5)


def _pack_units(units, max_chars):
    """Pack logical units into chunks near max_chars."""
    segments = []
    current = ""

    for unit in units:
        part = unit.strip()
        if not part:
            continue
        if not current:
            current = part
            continue
        if len(current) + len(part) + 2 > max_chars:
            segments.append(current.strip())
            current = part
        else:
            current = current + "\n\n" + part

    if current.strip():
        segments.append(current.strip())
    return segments


def segment_markdown_structured(text, max_tokens=1024):
    """Prefer heading-aware chunking for markdown-like docs."""
    heading_re = re.compile(r"^\s*(#{1,6}\s+\S+|第[一二三四五六七八九十\d]+[章节部分])")
    units = []
    buf = []

    for line in text.splitlines():
        if heading_re.match(line) and buf:
            units.append("\n".join(buf).strip())
            buf = [line]
        else:
            buf.append(line)

    if buf:
        units.append("\n".join(buf).strip())

    if not units:
        units = [p for p in text.split("\n\n") if p.strip()]

    return _pack_units(units, _max_chars(max_tokens))


def segment_code_aware(text, max_tokens=1024):
    """Keep fenced code blocks intact, chunk prose around them."""
    parts = re.split(r"(```[\s\S]*?```)", text)
    units = []

    for part in parts:
        chunk = part.strip()
        if not chunk:
            continue
        if chunk.startswith("```") and chunk.endswith("```"):
            units.append(chunk)
        else:
            units.extend([p.strip() for p in re.split(r"\n{2,}", chunk) if p.strip()])

    return _pack_units(units, _max_chars(max_tokens))


def segment_fixed_length(text, max_tokens=1024, overlap_ratio=0.12):
    """Fallback segmenter for structured/long continuous text."""
    content = text.strip()
    if not content:
        return []

    max_chars = _max_chars(max_tokens)
    step = max(200, int(max_chars * (1 - overlap_ratio)))
    segments = []
    start = 0

    while start < len(content):
        piece = content[start:start + max_chars].strip()
        if piece:
            segments.append(piece)
        if start + max_chars >= len(content):
            break
        start += step

    return segments


def segment_with_strategy(text, ext, max_tokens=1024):
    ext = ext.lower()

    if ext in MARKDOWN_EXTS:
        strategy = "markdown_recursive"
        segments = segment_markdown_structured(text, max_tokens=max_tokens)
    elif ext in CODE_EXTS:
        strategy = "code_aware"
        segments = segment_code_aware(text, max_tokens=max_tokens)
    elif ext in STRUCTURED_EXTS:
        strategy = "fixed_length"
        segments = segment_fixed_length(text, max_tokens=max_tokens)
    else:
        strategy = "paragraph_balanced"
        segments = smart_segment(text, max_tokens=max_tokens)

    if not segments:
        strategy = "fixed_length"
        segments = segment_fixed_length(text, max_tokens=max_tokens)

    return strategy, segments


def read_docx(path):
    """Extract text from a .docx file."""
    try:
        from docx import Document
        doc = Document(path)
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except ImportError:
        emit("warning", message=t("clean.docx_not_installed", filename=os.path.basename(path)))
        return None
    except Exception as e:
        emit("warning", message=f"Failed to read docx {path}: {e}")
        return None


def read_pdf(path):
    """Extract text from a .pdf file."""
    try:
        import PyPDF2
        text_parts = []
        with open(path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        return "\n\n".join(text_parts) if text_parts else None
    except ImportError:
        emit("warning", message=t("clean.pdf_not_installed", filename=os.path.basename(path)))
        return None
    except Exception as e:
        emit("warning", message=f"Failed to read pdf {path}: {e}")
        return None


def clean_file(input_path):
    """Clean a single file and return cleaned segments."""
    ext = os.path.splitext(input_path)[1].lower()

    # Handle docx/pdf via dedicated readers
    if ext == ".docx":
        text = read_docx(input_path)
        if text is None:
            return []
    elif ext == ".pdf":
        text = read_pdf(input_path)
        if text is None:
            return []
    else:
        # Plain text with encoding detection
        encodings = ["utf-8", "gbk", "gb2312", "gb18030", "big5", "latin-1"]
        text = None
        for enc in encodings:
            try:
                with open(input_path, "r", encoding=enc) as f:
                    text = f.read()
                break
            except (UnicodeDecodeError, UnicodeError):
                continue

    if text is None:
        return []

    text = fix_encoding(text)
    text = remove_noise(text)

    paragraphs = text.split("\n\n")
    paragraphs = dedup_paragraphs(paragraphs)
    paragraphs = filter_short(paragraphs, min_chars=20)

    if not paragraphs:
        return []

    # Rejoin and segment with strategy auto-match
    cleaned_text = "\n\n".join(paragraphs)
    strategy, segments = segment_with_strategy(cleaned_text, ext, max_tokens=1024)

    out = []
    for seg in segments:
        piece = seg.strip()
        if len(piece) < 20:
            continue
        out.append(
            {
                "text": piece,
                "strategy": strategy,
                "source_file": os.path.basename(input_path),
            }
        )
    return out


def main():
    parser = argparse.ArgumentParser(description="Courtyard data cleaning")
    parser.add_argument("--project-dir", required=True, help="Project directory path")
    add_lang_arg(parser)
    args = parser.parse_args()

    init_i18n(args.lang)

    raw_dir = os.path.join(args.project_dir, "raw")
    cleaned_dir = os.path.join(args.project_dir, "cleaned")
    os.makedirs(cleaned_dir, exist_ok=True)

    if not os.path.exists(raw_dir):
        emit("error", message=t("clean.raw_not_found", path=raw_dir))
        sys.exit(1)

    files = sorted([f for f in os.listdir(raw_dir) if os.path.isfile(os.path.join(raw_dir, f))])
    if not files:
        emit("error", message=t("clean.no_files"))
        sys.exit(1)

    total_files = len(files)
    total_raw_chars = 0
    total_cleaned_chars = 0
    total_segments = 0
    removed_dupes = 0
    removed_short = 0

    emit("progress", step=0, total=total_files, desc=t("clean.starting", count=total_files))

    all_segments = []
    raw_manifest = []

    for i, filename in enumerate(files):
        input_path = os.path.join(raw_dir, filename)
        try:
            stat_info = os.stat(input_path)
            raw_manifest.append(
                {
                    "name": filename,
                    "size_bytes": int(stat_info.st_size),
                    "modified_ts": int(stat_info.st_mtime),
                }
            )
        except OSError:
            raw_manifest.append(
                {
                    "name": filename,
                    "size_bytes": 0,
                    "modified_ts": 0,
                }
            )

        # Read raw for stats
        try:
            with open(input_path, "r", encoding="utf-8", errors="replace") as f:
                raw_text = f.read()
            total_raw_chars += len(raw_text)

            raw_paras = raw_text.split("\n\n")
            segments = clean_file(input_path)

            cleaned_chars = sum(len(s["text"]) for s in segments)
            total_cleaned_chars += cleaned_chars
            total_segments += len(segments)
            removed_dupes += max(0, len(raw_paras) - len(set(p.strip() for p in raw_paras if p.strip())))
            removed_short += len([p for p in raw_paras if 0 < len(p.strip()) < 20])

            all_segments.extend(segments)

        except Exception as e:
            emit("warning", message=t("clean.error_file", filename=filename, error=str(e)))
            continue

        emit("progress", step=i + 1, total=total_files, desc=t("clean.cleaned", filename=filename, segments=len(segments)))

    # Write cleaned output as single file
    output_path = os.path.join(cleaned_dir, "cleaned_all.txt")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n\n---\n\n".join(seg["text"] for seg in all_segments))

    # Also write individual segments for dataset generation
    segments_path = os.path.join(cleaned_dir, "segments.jsonl")
    with open(segments_path, "w", encoding="utf-8") as f:
        for idx, seg in enumerate(all_segments):
            f.write(
                json.dumps(
                    {
                        "id": idx,
                        "text": seg["text"],
                        "strategy": seg.get("strategy", "paragraph_balanced"),
                        "source_file": seg.get("source_file", ""),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    manifest_path = os.path.join(cleaned_dir, "segments_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {
                    "generated_at": int(time.time()),
                    "raw_files": raw_manifest,
                    "total_segments": total_segments,
                },
                ensure_ascii=False,
                indent=2,
            )
        )

    emit("complete",
         total_files=total_files,
         raw_chars=total_raw_chars,
         cleaned_chars=total_cleaned_chars,
         segments=total_segments,
         removed_dupes=removed_dupes,
         removed_short=removed_short)


if __name__ == "__main__":
    main()
