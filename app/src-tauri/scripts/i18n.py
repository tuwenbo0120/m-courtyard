"""Lightweight i18n module for Courtyard Python scripts.

Dual-context design:
  - t(key)  : UI / log language — controlled by --lang CLI arg.
  - pt(key) : Prompt language — auto-detected from source content.

Usage:
    from i18n import t, pt, init_i18n, init_prompt_i18n, detect_content_language
    init_i18n("zh-CN")                       # logs in Chinese
    lang = detect_content_language(segments)  # e.g. "en"
    init_prompt_i18n(lang)                    # prompts in English
    print(t("gen.connecting"))                # -> Chinese log
    print(pt("gen.prompt.qa.system"))         # -> English prompt

Locale files are stored in scripts/locales/<lang>.json.
Falls back to English ("en") for missing keys or unsupported languages.
"""

import json
import os
import re

# ─── Log / UI i18n state ───
_strings: dict = {}
_fallback: dict = {}
_current_lang: str = "en"

# ─── Prompt i18n state (separate from log) ───
_prompt_strings: dict = {}
_prompt_fallback: dict = {}
_prompt_lang: str = "en"

LOCALES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "locales")

# ─── Content language detection ───
# Each entry: (compiled_regex_pattern, locale_code)
# Order matters: more specific scripts (kana, hangul) listed before
# broader ones (CJK ideographs, Latin) to allow correct disambiguation.
_SCRIPT_DETECTORS = [
    (re.compile(r'[\u3040-\u309f\u30a0-\u30ff]'), "ja"),
    (re.compile(r'[\uac00-\ud7af\u1100-\u11ff]'), "ko"),
    (re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf]'), "zh-CN"),
    (re.compile(r'[\u0400-\u04ff]'), "ru"),
    (re.compile(r'[\u0600-\u06ff]'), "ar"),
    (re.compile(r'[A-Za-z]'), "en"),
]

# Locales whose unique script markers should take priority over raw
# character count. E.g. Japanese text contains both kanji (CJK) and
# kana; the presence of kana disambiguates it from Chinese.
_PRIORITY_LOCALES = {"ja", "ko"}


def _load_locale(lang: str) -> dict:
    """Load a locale JSON file. Returns empty dict if not found."""
    path = os.path.join(LOCALES_DIR, f"{lang}.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _locale_file_exists(lang: str) -> bool:
    return os.path.exists(os.path.join(LOCALES_DIR, f"{lang}.json"))


def init_i18n(lang: str = "en"):
    """Initialize i18n with the given language code.

    Loads the target language and English as fallback.
    Call this once at script startup before using t().
    """
    global _strings, _fallback, _current_lang
    _current_lang = lang
    _fallback = _load_locale("en")
    if lang == "en":
        _strings = _fallback
    else:
        _strings = _load_locale(lang)


def t(key: str, **kwargs) -> str:
    """Translate a key with optional interpolation (log / UI language).

    Looks up in current language first, falls back to English.
    Supports Python str.format() style placeholders: {name}, {count}, etc.
    Returns the key itself if no translation found.
    """
    text = _strings.get(key) or _fallback.get(key) or key
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, IndexError):
            pass
    return text


# ─── Prompt i18n ───

def detect_content_language(text_samples: list, sample_chars: int = 5000) -> str:
    """Detect dominant content language from text samples.

    Analyzes Unicode script distribution and returns the best matching
    BCP-47 locale code that has a corresponding locale file.
    Falls back to 'en' when detection is ambiguous or no locale file exists.
    """
    combined = " ".join(str(s)[:1000] for s in text_samples[:10])[:sample_chars]
    if not combined.strip():
        return "en"

    counts: dict = {}
    for pattern, locale in _SCRIPT_DETECTORS:
        n = len(pattern.findall(combined))
        if n > 0:
            counts[locale] = counts.get(locale, 0) + n

    if not counts:
        return "en"

    for locale in _PRIORITY_LOCALES:
        if counts.get(locale, 0) >= 10 and _locale_file_exists(locale):
            return locale

    best = max(counts, key=lambda k: counts[k])
    return best if _locale_file_exists(best) else "en"


def init_prompt_i18n(lang: str = "en"):
    """Initialize the prompt language context.

    Controls the language of prompts / templates sent to the LLM.
    Separate from the UI log language initialized by init_i18n().
    """
    global _prompt_strings, _prompt_fallback, _prompt_lang
    _prompt_lang = lang
    _prompt_fallback = _load_locale("en")
    if lang == "en":
        _prompt_strings = _prompt_fallback
    else:
        loaded = _load_locale(lang)
        _prompt_strings = loaded if loaded else _prompt_fallback


def pt(key: str, **kwargs) -> str:
    """Translate using the prompt language context.

    Use for LLM prompt templates and content-generation templates.
    Use t() for log / UI messages.
    """
    text = _prompt_strings.get(key) or _prompt_fallback.get(key) or key
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, IndexError):
            pass
    return text


def get_prompt_lang() -> str:
    """Return the current prompt language code."""
    return _prompt_lang


def add_lang_arg(parser):
    """Add --lang argument to an argparse parser."""
    parser.add_argument(
        "--lang", default="en",
        help="UI language code (en, zh-CN, etc.)"
    )
