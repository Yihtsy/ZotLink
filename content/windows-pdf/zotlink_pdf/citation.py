"""Citation metadata formatting for filenames."""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from .kinds import BOOK_TYPES, JOURNAL_TYPES
from .publishers import publisher_for_doi, publisher_for_name

INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
WHITESPACE_RE = re.compile(r"\s+")
MAX_PATH_LENGTH = 280
MAX_FILENAME_LENGTH = 255


def clean_filename_piece(text: str, *, collapse_whitespace: bool = True) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = INVALID_FILENAME_CHARS.sub(" ", text)
    if collapse_whitespace:
        text = WHITESPACE_RE.sub(" ", text)
    return text.strip(" .")


def _first_text(value: object) -> str | None:
    if isinstance(value, list) and value:
        return str(value[0])
    if isinstance(value, str):
        return value
    return None


def _strip_markup(text: str | None) -> str | None:
    if not text:
        return None
    text = re.sub(r"<[^>]+>", "", text)
    text = WHITESPACE_RE.sub(" ", text).strip()
    text = re.sub(r"\s+®", "®", text)
    return text or None


def _person_family(person: dict) -> str:
    return clean_filename_piece(str(person.get("family") or person.get("name") or "Unknown"))


def _people_cite_form(people: list[dict]) -> str | None:
    if not people:
        return None
    if len(people) == 1:
        return _person_family(people[0])
    if len(people) == 2:
        return f"{_person_family(people[0])} & {_person_family(people[1])}"
    return f"{_person_family(people[0])} et al."


def first_author_label(item: dict) -> str:
    return _people_cite_form(item.get("author") or []) or "Unknown"


def editor_label(item: dict) -> str | None:
    return _people_cite_form(item.get("editor") or [])


def item_years(item: dict) -> dict[str, int]:
    years: dict[str, int] = {}
    for key in ("indexed", "created", "deposited", "published-print", "published-online", "published", "issued"):
        parts = ((item.get(key) or {}).get("date-parts") or [])
        if parts and parts[0] and parts[0][0]:
            years[key] = int(parts[0][0])
    return years


def _publisher_code(doi: str | None, item: dict, publisher: str | None = None) -> str | None:
    if publisher:
        normalized = publisher.casefold().replace(".", "").replace(" ", "")
        if normalized in {"jb", "johnbenjamins", "benjamins"}:
            return "JB"
        if normalized in {"cup", "cambridge", "cambridgeuniversitypress"}:
            return "CUP"
        if normalized in {"routledge", "taylor&francis", "t&f", "taylorfrancis"}:
            return "Routledge"
        if normalized in {"springer", "springernature", "sn", "palgrave", "palgravemacmillan"}:
            return "Springer"
        if normalized in {"dg", "degruyter", "degruyter"}:
            return "dG"
        if normalized in {"bloomsbury"}:
            return "Bloomsbury"
        if normalized in {"oup", "oxford", "oxforduniversitypress"}:
            return "OUP"
        if normalized in {"wiley", "johnwiley", "johnwiley&sons"}:
            return "Wiley"

    publisher = publisher_for_name(item.get("publisher")) or publisher_for_doi(doi)
    if not publisher:
        return None
    name = publisher.name.casefold()
    abbreviation = publisher.abbreviation.casefold()
    if "john benjamins" in name or "john benjamins" in abbreviation:
        return "JB"
    if "cambridge university press" in name or abbreviation == "cup":
        return "CUP"
    if "routledge" in name or "taylor & francis" in name:
        return "Routledge"
    if "springer" in name or "palgrave" in name:
        return "Springer"
    if "de gruyter" in name:
        return "dG"
    if "bloomsbury" in name:
        return "Bloomsbury"
    if "oxford university press" in name or abbreviation == "oup":
        return "OUP"
    if "wiley" in name:
        return "Wiley"
    return publisher.abbreviation


def _document_kind(item: dict, document_type: str | None = None) -> str:
    if document_type == "book":
        return "book"
    if document_type == "journal_article":
        return "journal_article"
    work_type = item.get("type")
    if work_type in BOOK_TYPES:
        return "book"
    if work_type in JOURNAL_TYPES:
        return "journal_article"
    return "book" if item.get("editor") else "journal_article"


def item_year(item: dict, *, doi: str | None = None, publisher: str | None = None, document_type: str | None = None) -> str:
    years = item_years(item)
    if _document_kind(item, document_type=document_type) == "book":
        publisher_code = _publisher_code(doi, item, publisher=publisher)
        if publisher_code in {"Routledge", "JB", "Springer", "Wiley"} and "published-print" in years:
            return str(years["published-print"])
        if publisher_code in {"CUP", "dG", "Bloomsbury", "OUP"} and "created" in years:
            return str(years["created"])
        if "created" in years:
            return str(years["created"])
    else:
        for key in ("published-print", "published", "published-online", "created"):
            if key in years:
                return str(years[key])
    for key in ("published-print", "published", "published-online", "issued", "created", "deposited", "indexed"):
        if key in years:
            return str(years[key])
    return "n.d."


def item_title(item: dict) -> str:
    return clean_filename_piece(_strip_markup(_first_text(item.get("title"))) or "Untitled")


def item_subtitle(item: dict) -> str | None:
    return _strip_markup(_first_text(item.get("subtitle")))


def _split_title(title: str) -> tuple[str, str | None]:
    if ":" not in title:
        return title, None
    main, subtitle = title.split(":", 1)
    main = main.strip()
    subtitle = subtitle.strip()
    return main or title, subtitle or None


def _edition_suffix(item: dict) -> str:
    edition_number = item.get("edition-number")
    try:
        edition = int(edition_number)
    except (TypeError, ValueError):
        return ""
    if edition == 1:
        return ""
    if edition == 2:
        return " (2nd ed.)"
    if edition == 3:
        return " (3rd ed.)"
    return f" ({edition}th ed.)"


def _series_number(doi: str | None, item: dict, *, publisher: str | None = None, document_type: str | None = None) -> str | None:
    if _document_kind(item, document_type=document_type) != "book" or _publisher_code(doi, item, publisher=publisher) != "JB" or not doi:
        return None
    number = doi.split(".")[-1]
    return number if number.isdigit() else None


def _doc_type(item: dict) -> str | None:
    update_to = item.get("update-to") or []
    if update_to:
        return update_to[0].get("type")
    return item.get("type")


def _build_filename_stem(
    item: dict,
    *,
    doi: str | None,
    publisher: str | None,
    document_type: str | None,
    year_override: int | str | None,
    use_full_title: bool,
    split_inline_title: bool = False,
) -> str | None:
    author = _people_cite_form(item.get("author") or [])
    editor = editor_label(item)
    year = str(year_override) if year_override is not None else item_year(item, doi=doi, publisher=publisher, document_type=document_type)
    title = (_strip_markup(_first_text(item.get("title"))) or "Untitled").rstrip("?")
    field_subtitle = item_subtitle(item)
    if split_inline_title and ":" in title:
        main_title, inline_subtitle = _split_title(title)
        subtitle = field_subtitle or inline_subtitle
    elif field_subtitle:
        main_title = title
        subtitle = field_subtitle
    else:
        main_title, subtitle = title, None
    if subtitle:
        subtitle = subtitle.rstrip("?")

    edition_suffix = _edition_suffix(item)

    if author and editor:
        stem = f"{author} {year} {main_title}".strip()
        print("⚠️ Crossref record contains both author and editor, ambiguous")
    elif author:
        stem = f"{author} {year} {main_title}".strip()
    elif editor:
        editor_suffix = "(eds.)" if "et al." in editor or "&" in editor else "(ed.)"
        stem = f"{editor} {editor_suffix} {year} {main_title}".strip()
    else:
        print("⚠️ Crossref record has neither author nor editor, keeping original filename")
        return None

    if use_full_title and subtitle:
        stem = f"{stem}  {subtitle}{edition_suffix}".strip()
    elif edition_suffix:
        stem = f"{stem}{edition_suffix}".strip()

    series_number = _series_number(doi, item, publisher=publisher, document_type=document_type)
    if series_number:
        stem = f"{series_number}. {stem}"
    return clean_filename_piece(stem, collapse_whitespace=False)


def _shorten_filename_to_limits(
    filename: str,
    *,
    parent: Path | None,
    max_path_chars: int,
) -> str:
    """Trim only the title portion when Windows path limits still fail."""
    extension = Path(filename).suffix
    stem = filename[:-len(extension)] if extension else filename
    available = MAX_FILENAME_LENGTH
    if parent is not None:
        available = min(available, max_path_chars - len(str(parent)) - 1)
    if len(filename) <= available:
        return filename
    if available <= len(extension) + 1:
        raise ValueError(f"Even the extension cannot fit within the filename limit ({MAX_FILENAME_LENGTH})")
    shortened_stem = stem[: available - len(extension)].rstrip(" .")
    if not shortened_stem:
        raise ValueError(f"Filename limit leaves no usable title ({MAX_FILENAME_LENGTH})")
    return f"{shortened_stem}{extension}"

def build_citation_filename(
    item: dict,
    *,
    doi: str | None = None,
    publisher: str | None = None,
    document_type: str | None = None,
    year_override: int | str | None = None,
    extension: str = ".pdf",
    parent: Path | None = None,
    max_path_chars: int = MAX_PATH_LENGTH,
) -> str:
    if _doc_type(item) == "correction":
        return f"Correction{extension}"

    full_stem = _build_filename_stem(
        item,
        doi=doi,
        publisher=publisher,
        document_type=document_type,
        year_override=year_override,
        use_full_title=True,
        split_inline_title=False,
    )
    if full_stem is None:
        raise ValueError("Crossref record has neither author nor editor")
    full_filename = f"{full_stem}{extension}"
    if (parent is None or len(str(parent / full_filename)) <= max_path_chars) and len(full_filename) <= MAX_FILENAME_LENGTH:
        return full_filename

    main_stem = _build_filename_stem(
        item,
        doi=doi,
        publisher=publisher,
        document_type=document_type,
        year_override=year_override,
        use_full_title=False,
        split_inline_title=True,
    )
    if main_stem is None:
        raise ValueError("Crossref record has neither author nor editor")
    main_filename = f"{main_stem}{extension}"
    if parent is None or len(str(parent / main_filename)) <= max_path_chars:
        return _shorten_filename_to_limits(
            main_filename,
            parent=parent,
            max_path_chars=max_path_chars,
        )
    return _shorten_filename_to_limits(
        main_filename,
        parent=parent,
        max_path_chars=max_path_chars,
    )


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for number in range(2, 1000):
        candidate = path.with_name(f"{path.stem} ({number}){path.suffix}")
        if not candidate.exists():
            return candidate
    raise FileExistsError(f"Could not find an unused filename for {path}")
