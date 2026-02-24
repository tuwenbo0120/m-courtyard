#!/usr/bin/env python3
"""
Courtyard - Text extraction helper for binary document formats.
Extracts plain text from PDF/DOCX files for preview and snippet purposes.
Usage: python extract_text.py <file_path> [--max-chars N]
Output: extracted text to stdout
"""
import sys
import os
import argparse


def extract_pdf(path):
    """Extract text from a PDF file using PyPDF2."""
    try:
        import PyPDF2
    except ImportError:
        return None
    try:
        text_parts = []
        with open(path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        return "\n\n".join(text_parts) if text_parts else ""
    except Exception:
        return ""


def extract_docx(path):
    """Extract text from a DOCX file using python-docx."""
    try:
        from docx import Document
    except ImportError:
        return None
    try:
        doc = Document(path)
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception:
        return ""


def main():
    parser = argparse.ArgumentParser(description="Extract text from PDF/DOCX")
    parser.add_argument("file_path", help="Path to the file")
    parser.add_argument("--max-chars", type=int, default=0, help="Max characters to output (0 = unlimited)")
    args = parser.parse_args()

    path = args.file_path
    if not os.path.isfile(path):
        sys.exit(1)

    ext = os.path.splitext(path)[1].lower()

    if ext == ".pdf":
        text = extract_pdf(path)
    elif ext in (".docx", ".doc"):
        text = extract_docx(path)
    else:
        # Fallback: read as text
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except Exception:
            text = ""

    if text is None:
        # Library not installed
        print("__EXTRACT_LIB_MISSING__", end="")
        sys.exit(0)

    if args.max_chars > 0:
        text = text[:args.max_chars]

    print(text, end="")


if __name__ == "__main__":
    main()
