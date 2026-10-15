"""DOI priority and PDF writes for the independently bundled Windows tools."""
from __future__ import annotations

import os
import re
import shutil
import tempfile
from pathlib import Path

import pikepdf
from pypdf import PdfReader
from .doi import find_doi, normalize_doi


def extract_doi_from_text(reader: PdfReader, max_pages: int = 20) -> str | None:
    for index in range(min(len(reader.pages), max_pages)):
        text = reader.pages[index].extract_text() or ""
        doi = find_doi(text)
        if doi:
            return doi
    return None


def extract_doi(path: Path | str, max_pages: int = 20) -> str | None:
    reader = PdfReader(str(path))
    for key, value in (reader.metadata or {}).items():
        if str(key).lstrip("/").casefold() == "doi":
            doi = normalize_doi(str(value or ""))
            if not doi or not re.fullmatch(r"10\.\d{4,9}/\S+", doi, re.I):
                raise ValueError("PDF 的 /doi 存在但无效；请先修正该字段，未扫描页面")
            return doi
    # DOI URL is decorative: it cannot override or substitute for /doi.
    return extract_doi_from_text(reader, max_pages=max_pages)


def commit_pdf(path: Path, temporary: Path) -> None:
    """Validate output and write through the existing file to keep its file ID."""
    with pikepdf.open(temporary) as pdf:
        if not len(pdf.pages):
            raise ValueError("输出 PDF 没有页面")
    backup_fd, backup_name = tempfile.mkstemp(prefix="zotlink-backup-", suffix=".pdf", dir=path.parent)
    os.close(backup_fd)
    backup = Path(backup_name)
    preserve_backup = False
    try:
        shutil.copyfile(path, backup)
        try:
            with temporary.open("rb") as source, path.open("r+b") as destination:
                shutil.copyfileobj(source, destination)
                destination.truncate()
                destination.flush()
                os.fsync(destination.fileno())
        except Exception as error:
            try:
                shutil.copyfile(backup, path)
            except Exception as rollback:
                preserve_backup = True
                raise RuntimeError(f"PDF 写入失败且无法恢复；备份保留于 {backup}: {rollback}") from error
            raise
    finally:
        if not preserve_backup:
            backup.unlink(missing_ok=True)


def write_pdf_metadata(path: Path | str, doi: str, *, title_from_filename: bool = True, title: str | None = None) -> bool:
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix="zotlink-write-", suffix=".pdf", dir=path.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        with pikepdf.open(path) as pdf:
            wanted_title = title if title is not None else path.stem if title_from_filename else None
            expected = {"/doi": doi, "/doiURL": f"https://doi.org/{doi}"}
            if wanted_title is not None:
                expected["/Title"] = wanted_title
            changed = any(str(pdf.docinfo.get(key, "")) != value for key, value in expected.items())
            action = pdf.Root.get("/OpenAction")
            correct_action = (isinstance(action, pikepdf.Array) and len(action) == 2 and len(pdf.pages)
                              and action[0].objgen == pdf.pages[0].obj.objgen and str(action[1]) == "/Fit")
            preferences = pdf.Root.get("/ViewerPreferences", {})
            changed = changed or not correct_action or preferences.get("/DisplayDocTitle") is not False
            if "/Metadata" in pdf.Root:
                with pdf.open_metadata(set_pikepdf_as_editor=False, update_docinfo=False) as metadata:
                    for key in list(metadata):
                        name = key.rsplit(":", 1)[-1].casefold()
                        if name == "doi" and str(metadata[key]) != doi:
                            changed = True
                        elif name == "doiurl" and str(metadata[key]) != f"https://doi.org/{doi}":
                            changed = True
            if not changed:
                return False
            pdf.docinfo["/doi"] = doi
            pdf.docinfo["/doiURL"] = f"https://doi.org/{doi}"
            if title is not None:
                pdf.docinfo["/Title"] = title
            elif title_from_filename:
                pdf.docinfo["/Title"] = path.stem
            if len(pdf.pages):
                pdf.Root.OpenAction = pikepdf.Array([pdf.pages[0].obj, pikepdf.Name("/Fit")])
            if "/ViewerPreferences" not in pdf.Root:
                pdf.Root.ViewerPreferences = pikepdf.Dictionary()
            pdf.Root.ViewerPreferences.DisplayDocTitle = False
            # Keep any existing XMP DOI fields consistent with the authoritative Info DOI.
            if "/Metadata" in pdf.Root:
                with pdf.open_metadata(set_pikepdf_as_editor=False, update_docinfo=False) as metadata:
                    for key in list(metadata):
                        if key.rsplit(":", 1)[-1].casefold() == "doi":
                            metadata[key] = doi
                        elif key.rsplit(":", 1)[-1].casefold() == "doiurl":
                            metadata[key] = f"https://doi.org/{doi}"
            pdf.save(temporary)
        commit_pdf(path, temporary)
        return True
    finally:
        temporary.unlink(missing_ok=True)
