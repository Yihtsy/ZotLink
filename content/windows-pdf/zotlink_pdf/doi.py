"""DOI normalization and extraction helpers."""

from __future__ import annotations

import re

DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)


def normalize_doi(raw: str | None) -> str | None:
    """Return a bare DOI string from common DOI spellings and URLs."""
    if not raw:
        return None
    text = raw.strip()
    text = re.sub(r"^(?:doi\s*:?\s*|https?://(?:dx\.)?doi\.org/)", "", text, flags=re.I)
    text = re.sub(r"\s*([./:_;()-])\s*", r"\1", text)
    text = re.sub(r"\s+", "", text)
    text = text.strip().strip(".,;:]}")
    while text.endswith(")") and text.count(")") > text.count("("):
        text = text[:-1]
    text = text.replace("\u200b", "")
    return text or None


def find_doi(text: str | None) -> str | None:
    """Find and normalize a DOI in text, tolerating simple PDF spacing noise."""
    if not text:
        return None
    collapsed = re.sub(r"\s+", " ", text)
    collapsed = re.sub(r"(?<!\s)(https?://)", r"|\1", collapsed, flags=re.IGNORECASE)
    compact_punctuation = re.sub(r"\s*([./:_;()-])\s*", r"\1", collapsed)
    match = DOI_RE.search(compact_punctuation)
    if match:
        return normalize_doi(match.group(0))

    match = DOI_RE.search(collapsed)
    if match:
        return normalize_doi(match.group(0))
    return None
