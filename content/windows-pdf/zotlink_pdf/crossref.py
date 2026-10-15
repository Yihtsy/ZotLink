"""Crossref client helpers."""

from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote

import requests

USER_AGENT = "ZotLink Windows PDF tools (mailto:yihtsy@outlook.com)"
WHOLE_BOOK_TYPES = frozenset({"book", "edited-book", "monograph", "reference-book"})
_SESSION = requests.Session()


@lru_cache(maxsize=4096)
def fetch_crossref_item(doi: str, timeout: float = 20.0) -> dict | None:
    url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
    try:
        response = _SESSION.get(url, headers=headers, timeout=(5.0, timeout))
    except requests.exceptions.Timeout as error:
        raise RuntimeError("查询 Crossref 超时，请检查网络后重试；未修改 PDF 文件") from error
    except requests.exceptions.ConnectionError as error:
        raise RuntimeError("无法连接 Crossref，请检查网络、代理或防火墙后重试；未修改 PDF 文件") from error
    except requests.exceptions.RequestException as error:
        raise RuntimeError("Crossref 网络请求失败，请稍后重试；未修改 PDF 文件") from error
    if response.status_code == 404:
        return None
    try:
        response.raise_for_status()
    except requests.exceptions.HTTPError as error:
        raise RuntimeError(f"Crossref 服务返回 HTTP {response.status_code}，请稍后重试；未修改 PDF 文件") from error
    try:
        return response.json().get("message")
    except (ValueError, AttributeError) as error:
        raise RuntimeError("Crossref 返回的数据格式异常，请稍后重试；未修改 PDF 文件") from error


def is_whole_book_type(work_type: object) -> bool:
    """Return whether Crossref identifies a work as a complete book."""
    return isinstance(work_type, str) and work_type in WHOLE_BOOK_TYPES
