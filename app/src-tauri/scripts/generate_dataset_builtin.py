#!/usr/bin/env python3
"""Built-in rule-based dataset generation without AI dependency.

Generates training data using NLP heuristics:
- Heading-based Q&A extraction
- Key sentence extraction + template filling
- Paragraph → instruction-output conversion
"""

import argparse
import json
import os
import re
import sys
import random

from i18n import t, pt, init_i18n, init_prompt_i18n, detect_content_language, add_lang_arg


def emit(event_type, **kwargs):
    payload = {"type": event_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def load_segments_from_file(path: str) -> list[dict]:
    """Load segments jsonl/text file into normalized records."""
    records: list[dict] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                obj = {"text": line}

            if isinstance(obj, dict):
                text = str(obj.get("text", "")).strip()
                rec = dict(obj)
            elif isinstance(obj, str):
                text = obj.strip()
                rec = {"text": text}
            else:
                continue

            if len(text) < 20:
                continue
            rec["text"] = text
            records.append(rec)

    return records


def compute_quality_score(total: int, success: int, avg_output_len: float) -> tuple[float, str]:
    if total <= 0:
        return 0.0, "C"
    success_rate = success / total
    reliability_score = success_rate * 70.0
    richness_score = min(avg_output_len / 240.0, 1.0) * 20.0
    volume_score = min(success / 10.0, 1.0) * 10.0
    score = round(reliability_score + richness_score + volume_score, 1)
    if score >= 85:
        grade = "A"
    elif score >= 70:
        grade = "B"
    else:
        grade = "C"
    return score, grade


# ── Rule-based generators ──────────────────────────────────────────

def extract_heading_qa(text: str) -> list[dict]:
    """Extract Q&A pairs from heading-like lines."""
    results = []
    lines = text.strip().split("\n")
    heading_pattern = re.compile(r'^#{1,6}\s+(.+)$|^(.{5,30})[：:]$|^第[一二三四五六七八九十\d]+[章节部分]\s*(.+)$')

    for i, line in enumerate(lines):
        match = heading_pattern.match(line.strip())
        if match:
            heading = match.group(1) or match.group(2) or match.group(3)
            if not heading:
                continue
            # Collect following paragraph as answer
            body_lines = []
            for j in range(i + 1, min(i + 20, len(lines))):
                next_line = lines[j].strip()
                if not next_line:
                    if body_lines:
                        break
                    continue
                if heading_pattern.match(next_line):
                    break
                body_lines.append(next_line)

            if body_lines and len("".join(body_lines)) >= 20:
                answer = "\n".join(body_lines)
                question = pt("builtin.heading_question", heading=heading.strip('# ').strip())
                results.append({
                    "messages": [
                        {"role": "user", "content": question},
                        {"role": "assistant", "content": answer},
                    ]
                })
    return results


def extract_sentence_qa(text: str) -> list[dict]:
    """Generate Q&A from key sentences using templates."""
    results = []
    # Split into sentences
    sentences = re.split(r'[。！？\n]+', text)
    sentences = [s.strip() for s in sentences if len(s.strip()) >= 15]

    templates = [
        (pt("builtin.explain", topic="{topic}"), "{content}"),
        (pt("builtin.what_is", topic="{topic}"), "{content}"),
        (pt("builtin.describe", topic="{topic}"), "{content}"),
        (pt("builtin.tell_me", topic="{topic}"), "{content}"),
    ]

    for sent in sentences:
        if len(sent) > 200:
            continue
        # Detect language
        has_cjk = bool(re.search(r'[\u4e00-\u9fff]', sent))

        # Extract topic (first noun phrase or first clause)
        if has_cjk:
            # Take first meaningful segment
            parts = re.split(r'[，,；;、]', sent)
            topic = parts[0][:20] if parts else sent[:20]
        else:
            parts = re.split(r'[,;]', sent)
            topic = parts[0][:40] if parts else sent[:40]

        template = random.choice(templates)
        q = template[0].format(topic=topic)
        a = template[1].format(content=sent)

        results.append({
            "messages": [
                {"role": "user", "content": q},
                {"role": "assistant", "content": a},
            ]
        })

    return results


def paragraph_to_style(text: str) -> list[dict]:
    """Convert paragraphs to style-imitation training format.

    For style fine-tuning, the model learns to respond in the target writing style.
    - instruction: A creative writing prompt asking for content in the target style
    - output: The original text (as a style exemplar for the model to learn from)
    """
    results = []
    paragraphs = text.split("\n\n")
    paragraphs = [p.strip() for p in paragraphs if len(p.strip()) >= 30]

    style_templates = [
        pt("builtin.style_1"),
        pt("builtin.style_2"),
        pt("builtin.style_3"),
        pt("builtin.style_4"),
        pt("builtin.style_5"),
    ]

    for para in paragraphs:
        if len(para) > 2000:
            para = para[:2000]
        instruction = random.choice(style_templates)

        results.append({
            "messages": [
                {"role": "user", "content": instruction},
                {"role": "assistant", "content": para},
            ]
        })

    return results


def paragraph_to_instruct(text: str) -> list[dict]:
    """Convert paragraphs to instruction-output format."""
    results = []
    paragraphs = text.split("\n\n")
    paragraphs = [p.strip() for p in paragraphs if len(p.strip()) >= 30]

    instruct_templates = [
        pt("builtin.instruct_1"),
        pt("builtin.instruct_2"),
        pt("builtin.instruct_3"),
        pt("builtin.instruct_4"),
        pt("builtin.instruct_5"),
        pt("builtin.instruct_6"),
    ]

    for para in paragraphs:
        if len(para) > 2000:
            para = para[:2000]
        instruction = random.choice(instruct_templates)

        # For instruct mode, use the paragraph as context and generate a structured response
        results.append({
            "messages": [
                {"role": "user", "content": f"{instruction}\n\n{para}"},
                {"role": "assistant", "content": para},
            ]
        })

    return results


# ── Main ───────────────────────────────────────────────────────────

def generate_builtin(segments: list[str], mode: str) -> list[dict]:
    """Generate dataset using rule-based methods."""
    all_results = []

    for text in segments:
        if mode == "qa":
            # Try heading extraction first, fallback to sentence extraction
            items = extract_heading_qa(text)
            if not items:
                items = extract_sentence_qa(text)
            all_results.extend(items)
        elif mode == "style":
            # For style, use dedicated style-imitation format
            all_results.extend(paragraph_to_style(text))
        elif mode == "chat":
            # For chat, generate simple Q&A pairs
            items = extract_sentence_qa(text)
            all_results.extend(items)
        elif mode == "instruct":
            all_results.extend(paragraph_to_instruct(text))

    return all_results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--output-dir", default=None, help="Output directory for dataset files")
    parser.add_argument("--mode", default="qa", choices=["qa", "style", "chat", "instruct"])
    parser.add_argument("--input-segments", default=None, help="Optional segments jsonl input path")
    parser.add_argument("--quality-scoring", action="store_true", help="Enable post-generation quality scoring")
    add_lang_arg(parser)
    args = parser.parse_args()

    init_i18n(args.lang)

    segments_path = args.input_segments or os.path.join(args.project_dir, "cleaned", "segments.jsonl")
    if not os.path.exists(segments_path):
        emit("error", message=t("builtin.no_segments"))
        sys.exit(1)

    segment_records = load_segments_from_file(segments_path)
    segments = [rec["text"] for rec in segment_records]

    if not segments:
        emit("error", message=t("builtin.no_valid_segments"))
        sys.exit(1)

    # Detect content language → use matching templates for generated data
    content_lang = detect_content_language(segments)
    init_prompt_i18n(content_lang)
    emit("log", message=t("gen.detected_lang", lang=content_lang))

    total = len(segments)
    emit("progress", step=0, total=total, desc=t("builtin.starting", count=total, mode=args.mode))

    results = []
    failed_records: list[dict] = []
    for i, text in enumerate(segments):
        segment_record = dict(segment_records[i])
        items = generate_builtin([text], args.mode)
        if items:
            results.extend(items)
        else:
            failed_records.append({**segment_record, "reason": "no_items_generated"})
        emit("progress", step=i + 1, total=total,
             desc=t("builtin.complete", count=len(results)))

    if not results:
        emit("error", message=t("builtin.no_valid_segments"))
        sys.exit(1)

    # Shuffle and deduplicate
    random.shuffle(results)
    seen = set()
    unique_results = []
    for item in results:
        key = json.dumps(item, ensure_ascii=False, sort_keys=True)
        if key not in seen:
            seen.add(key)
            unique_results.append(item)
    results = unique_results

    # Write train/valid split
    dataset_dir = args.output_dir if args.output_dir else os.path.join(args.project_dir, "dataset")
    os.makedirs(dataset_dir, exist_ok=True)

    split_idx = max(1, int(len(results) * 0.9))
    train_data = results[:split_idx]
    valid_data = results[split_idx:] if split_idx < len(results) else results[-1:]

    with open(os.path.join(dataset_dir, "train.jsonl"), "w", encoding="utf-8") as f:
        for item in train_data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    with open(os.path.join(dataset_dir, "valid.jsonl"), "w", encoding="utf-8") as f:
        for item in valid_data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    failed_path = os.path.join(dataset_dir, "failed_segments.jsonl")
    with open(failed_path, "w", encoding="utf-8") as f:
        for rec in failed_records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    if args.quality_scoring:
        success_segments = total - len(failed_records)
        output_lengths = []
        for item in results:
            try:
                msgs = item.get("messages", [])
                assistant_msgs = [m.get("content", "") for m in msgs if m.get("role") == "assistant"]
                output_lengths.extend(len(str(s)) for s in assistant_msgs if str(s).strip())
            except Exception:
                continue

        avg_output_len = (sum(output_lengths) / len(output_lengths)) if output_lengths else 0.0
        score, grade = compute_quality_score(total=total, success=success_segments, avg_output_len=avg_output_len)
        quality_payload = {
            "score": score,
            "grade": grade,
            "success": success_segments,
            "failed": len(failed_records),
            "total": total,
            "generated_samples": len(results),
            "success_rate": round((success_segments / total) if total > 0 else 0.0, 4),
            "avg_output_len": round(avg_output_len, 1),
        }
        quality_path = os.path.join(dataset_dir, "quality.json")
        with open(quality_path, "w", encoding="utf-8") as f:
            json.dump(quality_payload, f, ensure_ascii=False, indent=2)

    emit("complete",
         train_count=len(train_data),
         valid_count=len(valid_data),
         failed=len(failed_records),
         total=total)


if __name__ == "__main__":
    main()
