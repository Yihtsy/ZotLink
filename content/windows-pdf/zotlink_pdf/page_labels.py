"""DOI-aware PDF page-label alignment helpers."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from collections import Counter
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

import pikepdf
from pypdf import PdfReader

from .crossref import fetch_crossref_item
from .pdf import extract_doi
from .pdf import commit_pdf

ExtraPlacement = Literal["auto", "front", "back", "split"]

CROSSREF_CONTAINER_WORK_TYPES = frozenset(
    {
        "book",
        "book-series",
        "book-set",
        "edited-book",
        "journal",
        "journal-issue",
        "journal-volume",
        "monograph",
        "proceedings",
        "proceedings-series",
        "reference-book",
    }
)

PAGE_RANGE_RE = re.compile(r"^\s*([A-Za-z]*)(\d+)\s*[-–—]\s*([A-Za-z]*)(\d+)\s*$")
SINGLE_PAGE_RE = re.compile(r"^\s*([A-Za-z]*)(\d+)\s*$")
EDGE_TEXT_PAGE_LIMIT = 3


def _publisher_family(doi: str | None, publisher: str) -> str:
    value = publisher.casefold()
    if (doi or "").startswith("10.1080/") or any(name in value for name in ("taylor", "francis", "routledge", "informa")):
        return "taylor-francis"
    if "jstor" in value or (doi or "").startswith("10.2307/"):
        return "jstor"
    if "proquest" in value:
        return "proquest"
    if "ebsco" in value:
        return "ebsco"
    return "unknown"


def _extra_page_kind(text: str, family: str) -> str | None:
    compact = re.sub(r"\s+", " ", text).casefold()
    tf_identifier = family == "taylor-francis" or any(value in compact for value in ("taylor & francis", "tandfonline.com", "informa"))
    if tf_identifier and (("to cite this article" in compact and "to link to this article" in compact)
                          or "full terms & conditions of access" in compact):
        return "front"
    if (family == "jstor" or "jstor" in compact) and any(value in compact for value in ("stable url", "your use of the jstor", "your use of jstor")):
        return "front"
    if (family == "proquest" or "proquest" in compact) and any(value in compact for value in ("reproduced with permission", "further reproduction prohibited", "copyright")):
        return "back"
    if (family == "ebsco" or "ebsco" in compact) and "copyright" in compact and any(value in compact for value in ("permission", "reproduced", "may not be copied", "individual use")):
        return "back"
    return None


@dataclass(frozen=True)
class ArticlePageRange:
    first_label: str
    last_label: str | None = None
    first_number: int | None = None
    last_number: int | None = None
    prefix: str = ""

    @property
    def page_count(self) -> int | None:
        if self.first_number is None or self.last_number is None:
            return None
        return self.last_number - self.first_number + 1


@dataclass(frozen=True)
class PageLabelPlan:
    pdf_page_count: int
    article_start_index: int
    article_page_count: int
    article_start_number: int | None
    article_prefix: str
    front_extra_pages: int = 0
    back_extra_pages: int = 0
    skipped_label_prefix: str | None = None
    front_label: str = "cover page"
    front_label_prefix: str = "Frontmatter-"
    back_label: str = "Endmatter"
    back_label_prefix: str = "Endmatter-"
    source: str = "crossref-page"
    already_aligned: bool = False


def parse_crossref_page_range(value: str | None) -> ArticlePageRange | None:
    """Parse Crossref's `page` value into an article page range."""
    if not value:
        return None
    text = value.strip()

    match = PAGE_RANGE_RE.match(text)
    if match:
        first_prefix, first_number_text, last_prefix, last_number_text = match.groups()
        first_number = int(first_number_text)
        last_number = int(last_number_text)

        if last_number < first_number:
            base = 10 ** len(last_number_text)
            last_number = (first_number // base) * base + last_number
            if last_number < first_number:
                last_number += base

        prefix = first_prefix or last_prefix
        return ArticlePageRange(
            first_label=f"{first_prefix}{first_number_text}",
            last_label=f"{last_prefix}{last_number_text}",
            first_number=first_number,
            last_number=last_number,
            prefix=prefix,
        )

    match = SINGLE_PAGE_RE.match(text)
    if match:
        prefix, number_text = match.groups()
        number = int(number_text)
        return ArticlePageRange(
            first_label=text,
            last_label=text,
            first_number=number,
            last_number=number,
            prefix=prefix,
        )

    return ArticlePageRange(first_label=text, prefix=text)


def _split_extra_pages(extra_pages: int, placement: ExtraPlacement) -> tuple[int, int]:
    if extra_pages <= 0:
        return 0, 0
    if placement == "auto":
        return extra_pages, 0
    if placement == "front":
        return extra_pages, 0
    if placement == "back":
        return 0, extra_pages
    if placement == "split":
        front = (extra_pages + 1) // 2
        return front, extra_pages - front
    raise ValueError(f"Unsupported extra page placement: {placement}")


def _contains_page_label(text: str, label: str) -> bool:
    label = label.strip()
    if not label:
        return False
    if label.isdigit() and len(label) < 2:
        return False
    return re.search(rf"(?<![A-Za-z0-9]){re.escape(label)}(?![A-Za-z0-9])", text) is not None


def _contains_doi(text: str, doi: str | None) -> bool:
    if not doi:
        return False
    compact_text = re.sub(r"\s+", "", text.lower())
    compact_doi = re.sub(r"\s+", "", doi.lower())
    return compact_doi in compact_text


def _infer_article_start_index(
    reader: PdfReader,
    article_range: ArticlePageRange,
    article_page_count: int,
    *,
    doi: str | None = None,
    publisher: str = "",
    article_title: str = "",
) -> int | None:
    max_start = len(reader.pages) - article_page_count
    if max_start <= 0:
        return 0

    first_labels = [article_range.first_label]
    if article_range.first_number is not None:
        first_labels.append(str(article_range.first_number))

    last_labels: list[str] = []
    if article_range.last_label:
        last_labels.append(article_range.last_label)
    if article_range.last_number is not None:
        last_labels.append(str(article_range.last_number))

    # Inspect only bounded edge pages. Crossref's range already gives the number
    # of extra pages; publisher/aggregator signatures determine their placement.
    family = _publisher_family(doi, publisher)
    total = len(reader.pages)
    edge_count = min(EDGE_TEXT_PAGE_LIMIT, max_start + 1, total)
    indexes = list(dict.fromkeys(list(range(edge_count)) + list(range(max(0, total - edge_count), total))))
    texts = {}
    kinds = {}
    for index in indexes:
        try:
            texts[index] = reader.pages[index].extract_text() or ""
        except Exception:
            continue
        kinds[index] = _extra_page_kind(texts[index], family)

    candidates: Counter[int] = Counter()
    front = 0
    while front < max_start and kinds.get(front) == "front":
        front += 1
    back = 0
    while back < max_start and kinds.get(total - back - 1) == "back":
        back += 1
    if front and back and front + back == max_start:
        candidates[front] += 20
    elif front == max_start:
        candidates[front] += 12
    elif back == max_start:
        candidates[0] += 12

    for index, text in texts.items():
        # A recognized publisher cover can quote the article's DOI and page range.
        if kinds.get(index):
            continue
        title_words = re.findall(r"\w+", re.sub(r"<[^>]+>", " ", article_title).casefold())
        page_words = set(re.findall(r"\w+", text.casefold()))
        title_match = len(" ".join(title_words)) >= 20 and sum(word in page_words for word in title_words) / len(title_words) >= 0.85
        if title_match and 0 <= index <= max_start:
            candidates[index] += 6
            if re.search(r"\b(?:abstract|introduction|keywords)\b", text, re.I):
                candidates[index] += 3

        if any(_contains_page_label(text, label) for label in first_labels):
            if 0 <= index <= max_start:
                candidates[index] += 3

        if any(_contains_page_label(text, label) for label in last_labels):
            start_index = index - article_page_count + 1
            if 0 <= start_index <= max_start:
                candidates[start_index] += 3

        if _contains_doi(text, doi):
            if 0 <= index <= max_start:
                candidates[index] += 1

    # A detected cover only establishes a lower bound; sparse extra pages may
    # follow it. Require positive evidence for the actual first content page.
    candidates = Counter({index: score for index, score in candidates.items() if front <= index <= max_start - back})
    if not candidates:
        return None
    return candidates.most_common(1)[0][0]


def build_page_label_plan(
    *,
    pdf_page_count: int,
    article_range: ArticlePageRange,
    extra_placement: ExtraPlacement = "front",
    skipped_label_prefix: str | None = None,
    article_number: str | None = None,
    article_start_index: int | None = None,
) -> PageLabelPlan:
    """Build a page-label plan from Crossref page metadata and PDF length."""
    article_page_count = article_range.page_count
    source = "crossref-page"

    if article_page_count is None:
        article_page_count = pdf_page_count
        source = "crossref-article-number" if article_number else "crossref-page-label"

    extra_pages = max(pdf_page_count - article_page_count, 0)
    if article_start_index is None:
        front_extra, back_extra = _split_extra_pages(extra_pages, extra_placement)
    else:
        front_extra = min(max(article_start_index, 0), extra_pages)
        back_extra = extra_pages - front_extra
    article_page_count = min(article_page_count, max(pdf_page_count - front_extra - back_extra, 0))

    article_prefix = article_range.prefix
    article_start_number = article_range.first_number
    if article_number and article_range.page_count is None:
        article_prefix = f"{article_number}-"
        article_start_number = 1

    return PageLabelPlan(
        pdf_page_count=pdf_page_count,
        article_start_index=front_extra,
        article_page_count=article_page_count,
        article_start_number=article_start_number,
        article_prefix=article_prefix,
        front_extra_pages=front_extra,
        back_extra_pages=back_extra,
        skipped_label_prefix=skipped_label_prefix,
        source=source,
    )


def labels_for_plan(plan: PageLabelPlan) -> list[str]:
    """Return the labels that should be visible after applying a plan."""
    labels: list[str] = []
    article_last = plan.article_start_index + plan.article_page_count

    for index in range(plan.pdf_page_count):
        if index < plan.article_start_index:
            if plan.skipped_label_prefix is not None:
                labels.append(f"{plan.skipped_label_prefix}{index + 1}")
            elif index == 0:
                labels.append(plan.front_label)
            else:
                labels.append(f"{plan.front_label_prefix}{index + 1}")
        elif index < article_last:
            if plan.article_start_number is None:
                labels.append(plan.article_prefix)
            else:
                labels.append(f"{plan.article_prefix}{plan.article_start_number + index - plan.article_start_index}")
        else:
            back_number = plan.front_extra_pages + index - article_last + 1
            if plan.skipped_label_prefix is not None:
                labels.append(f"{plan.skipped_label_prefix}{back_number}")
            elif plan.back_extra_pages == 1:
                labels.append(plan.back_label)
            else:
                labels.append(f"{plan.back_label_prefix}{back_number - plan.front_extra_pages}")

    return labels


def _write_with_page_label_plan(path: Path, plan: PageLabelPlan, *, dry_run: bool) -> None:
    if dry_run:
        return

    nums = pikepdf.Array()

    if plan.front_extra_pages:
        if plan.skipped_label_prefix is not None:
            front_label = pikepdf.Dictionary(
                {"/S": pikepdf.Name("/D"), "/P": plan.skipped_label_prefix, "/St": 1}
            )
        elif plan.front_extra_pages:
            front_label = pikepdf.Dictionary({"/P": plan.front_label})
        else:
            front_label = pikepdf.Dictionary(
                {"/S": pikepdf.Name("/D"), "/P": plan.front_label_prefix, "/St": 1}
            )
        nums.extend([0, front_label])
        if plan.front_extra_pages > 1 and plan.skipped_label_prefix is None:
            nums.extend([1, pikepdf.Dictionary({"/S": pikepdf.Name("/D"), "/P": plan.front_label_prefix, "/St": 2})])

    article_first = plan.article_start_index
    article_last = article_first + plan.article_page_count - 1
    if plan.article_page_count:
        if plan.article_start_number is None:
            label = pikepdf.Dictionary({"/P": plan.article_prefix})
        else:
            label = pikepdf.Dictionary(
                {
                    "/S": pikepdf.Name("/D"),
                    "/P": plan.article_prefix,
                    "/St": plan.article_start_number,
                }
            )
        nums.extend([article_first, label])

    if plan.back_extra_pages:
        back_first = article_last + 1
        if plan.skipped_label_prefix is not None:
            back_label = pikepdf.Dictionary(
                {
                    "/S": pikepdf.Name("/D"),
                    "/P": plan.skipped_label_prefix,
                    "/St": plan.front_extra_pages + 1,
                }
            )
        elif plan.back_extra_pages == 1:
            back_label = pikepdf.Dictionary({"/P": plan.back_label})
        else:
            back_label = pikepdf.Dictionary(
                {"/S": pikepdf.Name("/D"), "/P": plan.back_label_prefix, "/St": 1}
            )
        nums.extend([back_first, back_label])

    fd, tmp_name = tempfile.mkstemp(prefix=path.stem + ".", suffix=".pdf", dir=str(path.parent))
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        with pikepdf.Pdf.open(path) as pdf:
            pdf.Root.PageLabels = pikepdf.Dictionary({"/Nums": nums})
            pdf.save(tmp_path)
        commit_pdf(path, tmp_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def update_pdf_page_labels_from_crossref(
    path: Path | str,
    *,
    doi: str | None = None,
    crossref_item: dict | None = None,
    max_pages: int = 3,
    extra_placement: ExtraPlacement = "auto",
    skipped_label_prefix: str | None = None,
    dry_run: bool = False,
) -> PageLabelPlan | None:
    """Update PageLabels from a DOI's paginated Crossref component record.

    Journal articles, proceedings articles, chapters, and other component-level
    records are accepted when Crossref supplies a conventional page range.
    Whole-publication container records such as books and proceedings are
    skipped.
    """
    path = Path(path)
    doi = doi or extract_doi(path, max_pages=max_pages)
    if not doi and crossref_item is None:
        return None

    item = crossref_item or fetch_crossref_item(doi)  # type: ignore[arg-type]
    if not item:
        return None
    if item.get("type") in CROSSREF_CONTAINER_WORK_TYPES:
        return None

    page_value = item.get("page")
    if not isinstance(page_value, str) or not PAGE_RANGE_RE.match(page_value):
        return None

    article_range = parse_crossref_page_range(page_value)
    article_number = item.get("article-number")
    if article_range is None or article_range.page_count is None:
        return None

    reader = PdfReader(str(path))
    pdf_page_count = len(reader.pages)
    if pdf_page_count < article_range.page_count:
        raise ValueError("PDF 页数少于 Crossref 常规页码范围，未修改文件")
    article_start_index = None
    if extra_placement == "auto":
        inferred_article_count = article_range.page_count or pdf_page_count
        article_start_index = _infer_article_start_index(
            reader,
            article_range,
            min(inferred_article_count, pdf_page_count),
            doi=doi,
            publisher=str(item.get("publisher") or ""),
            article_title=str((item.get("title") or [""])[0]) if isinstance(item.get("title"), list) else str(item.get("title") or ""),
        )

    plan = build_page_label_plan(
        pdf_page_count=pdf_page_count,
        article_range=article_range,
        extra_placement=extra_placement,
        skipped_label_prefix=skipped_label_prefix,
        article_number=str(article_number) if article_number else None,
        article_start_index=article_start_index,
    )
    if extra_placement == "auto" and pdf_page_count > article_range.page_count:
        plan = replace(plan, source="crossref-page/edge-evidence" if article_start_index is not None else "crossref-page/front-fallback")

    if reader.page_labels == labels_for_plan(plan):
        return replace(plan, already_aligned=True)

    _write_with_page_label_plan(path, plan, dry_run=dry_run)
    return plan


def align_journal_article_page_labels(
    path: Path | str,
    *,
    doi: str | None = None,
    crossref_item: dict | None = None,
    max_pages: int = 3,
    extra_placement: ExtraPlacement = "auto",
    skipped_label_prefix: str | None = None,
    dry_run: bool = False,
) -> PageLabelPlan | None:
    """Compatibility alias for :func:`update_pdf_page_labels_from_crossref`."""
    return update_pdf_page_labels_from_crossref(
        path,
        doi=doi,
        crossref_item=crossref_item,
        max_pages=max_pages,
        extra_placement=extra_placement,
        skipped_label_prefix=skipped_label_prefix,
        dry_run=dry_run,
    )
