"""Independent bundled-PDF tests, with no network requests or local pydfdoi."""
import sys
import tempfile
import unittest
import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1] / "content" / "windows-pdf"
sys.path.insert(0, str(BASE))
from pypdf import PdfReader, PdfWriter
from zotlink_pdf.pdf import extract_doi, write_pdf_metadata
from zotlink_pdf.page_labels import update_pdf_page_labels_from_crossref
from zotlink_pdf.page_labels import _infer_article_start_index, parse_crossref_page_range
from zotlink_pdf.citation import build_citation_filename
from runner import run, main, write_json, drain_tasks


class PDFTests(unittest.TestCase):
    def test_crossref_network_errors_are_actionable(self):
        import requests
        from zotlink_pdf.crossref import fetch_crossref_item
        for error, message in [(requests.exceptions.Timeout(), "超时"),
                               (requests.exceptions.ConnectionError(), "无法连接")]:
            fetch_crossref_item.cache_clear()
            with patch("zotlink_pdf.crossref._SESSION.get", side_effect=error) as get:
                with self.assertRaisesRegex(RuntimeError, message):
                    fetch_crossref_item("10.1000/network-test")
                self.assertEqual(get.call_count, 1)
                self.assertEqual(get.call_args.kwargs["timeout"], (5.0, 20.0))

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="zotlink-pdf-test-")
        self.path = Path(self.directory.name) / "Original.pdf"

    def tearDown(self):
        self.directory.cleanup()

    def pdf(self, pages=3, metadata=None, texts=None):
        from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject
        writer = PdfWriter()
        for index in range(pages):
            page = writer.add_blank_page(300, 400)
            if texts:
                font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
                page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
                stream = DecodedStreamObject()
                stream.set_data(f"BT /F1 12 Tf 20 100 Td ({texts[index]}) Tj ET".encode("ascii"))
                page[NameObject("/Contents")] = writer._add_object(stream)
        if metadata:
            writer.add_metadata(metadata)
        writer.write(self.path)

    def test_metadata_priority_never_scans_pages(self):
        self.pdf(metadata={"/doi": "10.4018/978-1-61350-447-5.ch005", "/doiURL": "https://doi.org/10.9999/wrong"})
        with patch("zotlink_pdf.pdf.extract_doi_from_text", side_effect=AssertionError("must not scan")):
            self.assertEqual(extract_doi(self.path), "10.4018/978-1-61350-447-5.ch005")

    def test_missing_doi_scans_even_if_url_exists(self):
        self.pdf(metadata={"/doiURL": "https://doi.org/10.9999/decoration"})
        with patch("zotlink_pdf.pdf.extract_doi_from_text", return_value="10.1000/from-pages") as scan:
            self.assertEqual(extract_doi(self.path), "10.1000/from-pages")
            scan.assert_called_once()

    def test_invalid_existing_doi_does_not_rescan(self):
        self.pdf(metadata={"/doi": "invalid"})
        with patch("zotlink_pdf.pdf.extract_doi_from_text", side_effect=AssertionError("must not scan")):
            with self.assertRaises(ValueError):
                extract_doi(self.path)

    def test_write_metadata_keeps_identity_and_corrects_url(self):
        self.pdf(metadata={"/doi": "10.1000/example", "/doiURL": "wrong"})
        before = self.path.stat().st_ino
        write_pdf_metadata(self.path, "10.1000/example")
        self.assertEqual(self.path.stat().st_ino, before)
        reader = PdfReader(self.path)
        self.assertEqual(reader.metadata["/doiURL"], "https://doi.org/10.1000/example")
        self.assertEqual(len(reader.pages), 3)
        self.assertEqual(reader.trailer["/Root"]["/ViewerPreferences"]["/DisplayDocTitle"], False)

    def test_already_matching_metadata_is_not_rewritten(self):
        self.pdf(metadata={"/doi": "10.1000/example"})
        self.assertTrue(write_pdf_metadata(self.path, "10.1000/example"))
        before = self.path.read_bytes(), self.path.stat().st_mtime_ns
        self.assertFalse(write_pdf_metadata(self.path, "10.1000/example"))
        self.assertEqual((self.path.read_bytes(), self.path.stat().st_mtime_ns), before)

    def test_component_types_page_labels(self):
        for kind in ["journal-article", "proceedings-article", "book-chapter", "book-section"]:
            with self.subTest(kind=kind):
                self.pdf()
                before = self.path.stat().st_ino
                plan = update_pdf_page_labels_from_crossref(self.path, crossref_item={"type": kind, "page": "100-101"}, extra_placement="front")
                self.assertIsNotNone(plan)
                self.assertEqual(PdfReader(self.path).page_labels, ["cover page", "100", "101"])
                self.assertEqual(before, self.path.stat().st_ino)

    def test_multiple_front_pages_begin_with_cover_page(self):
        self.pdf(pages=4)
        update_pdf_page_labels_from_crossref(self.path, crossref_item={"type": "book-chapter", "page": "100-101"}, extra_placement="front")
        self.assertEqual(PdfReader(self.path).page_labels, ["cover page", "Frontmatter-2", "100", "101"])

    def test_auto_locates_two_front_and_two_back_pages(self):
        self.pdf(pages=6, texts=["Publisher cover", "Publisher notice", "100 First article page", "101 Last article page", "Publisher advertising", "Terms"])
        plan = update_pdf_page_labels_from_crossref(self.path, crossref_item={"type": "journal-article", "page": "100-101"})
        self.assertEqual(plan.front_extra_pages, 2)
        self.assertEqual(plan.back_extra_pages, 2)
        self.assertEqual(PdfReader(self.path).page_labels, ["cover page", "Frontmatter-2", "100", "101", "Endmatter-1", "Endmatter-2"])

    def test_body_first_page_after_sparse_second_cover(self):
        title = "A detailed study of language markers in clinical populations"
        self.pdf(pages=7, texts=["Taylor & Francis To cite this article To link to this article", "Downloaded 2026", title + " Abstract clinical study DOI 10.1080/example", "101 body", "102 body", "103 body", "104 body"])
        plan = update_pdf_page_labels_from_crossref(self.path, doi="10.1080/example", crossref_item={"type": "journal-article", "page": "100-104", "publisher": "Taylor & Francis", "title": [title]})
        self.assertEqual(plan.front_extra_pages, 2)
        self.assertEqual(PdfReader(self.path).page_labels[:3], ["cover page", "Frontmatter-2", "100"])

    def test_edge_inspection_never_reads_middle_pages(self):
        class Page:
            def __init__(self, index): self.index = index
            def extract_text(self):
                called.append(self.index)
                if self.index not in {0, 1, 2, 17, 18, 19}:
                    raise AssertionError("Middle-page text extraction is forbidden")
                return {0: "Publisher cover", 1: "Sparse notice", 2: "100 First content page", 17: "115 Last content page", 18: "ProQuest Copyright reproduced with permission", 19: "EBSCO copyright may not be copied"}[self.index]
        called = []
        reader = type("Reader", (), {"pages": [Page(index) for index in range(20)]})()
        start = _infer_article_start_index(reader, parse_crossref_page_range("100-115"), 16)
        self.assertEqual(start, 2)
        self.assertEqual(set(called), {0, 1, 2, 17, 18, 19})

    def test_jstor_first_page_is_not_body_despite_quoted_page_range(self):
        title = "Exploring robust features for linguistic analysis"
        self.pdf(pages=4, texts=["JSTOR stable URL 100 102 " + title, "100 " + title + " Abstract", "101 Body", "102 Last body page"])
        plan = update_pdf_page_labels_from_crossref(self.path, doi="10.2307/example", crossref_item={"type": "journal-article", "page": "100-102", "title": [title]})
        self.assertEqual(plan.front_extra_pages, 1)

    def test_alignment_discovers_and_writes_doi(self):
        self.pdf(texts=["Publisher cover", "100 DOI 10.1000/example", "101 Last article page"])
        with patch("zotlink_pdf.crossref.fetch_crossref_item", return_value={"DOI": "10.1000/example", "type": "journal-article", "page": "100-101"}):
            result = run(self.path, "page-labels")
        self.assertTrue(result["changed"])
        reader = PdfReader(self.path)
        self.assertEqual(reader.metadata["/doi"], "10.1000/example")
        self.assertEqual(reader.metadata["/doiURL"], "https://doi.org/10.1000/example")
        self.assertEqual(reader.page_labels, ["cover page", "100", "101"])

    def test_alignment_uses_existing_doi_and_repairs_url(self):
        self.pdf(metadata={"/doi": "10.1000/example", "/doiURL": "wrong"})
        with patch("zotlink_pdf.pdf.extract_doi_from_text", side_effect=AssertionError("must not rescan DOI")), \
             patch("zotlink_pdf.crossref.fetch_crossref_item", return_value={"DOI": "10.1000/example", "type": "journal-article", "page": "100-101"}):
            run(self.path, "page-labels")
        self.assertEqual(PdfReader(self.path).metadata["/doiURL"], "https://doi.org/10.1000/example")

    def test_containers_and_article_numbers_unchanged(self):
        self.pdf()
        original = self.path.read_bytes()
        for item in [{"type": "book", "page": "1-3"}, {"type": "proceedings", "page": "1-3"}, {"type": "journal-article", "page": "e123"}]:
            self.assertIsNone(update_pdf_page_labels_from_crossref(self.path, crossref_item=item))
            self.assertEqual(self.path.read_bytes(), original)

    def test_short_pdf_not_modified(self):
        self.pdf(pages=1)
        original = self.path.read_bytes()
        with self.assertRaises(ValueError):
            update_pdf_page_labels_from_crossref(self.path, crossref_item={"type": "journal-article", "page": "1-20"})
        self.assertEqual(self.path.read_bytes(), original)

    def test_rename_with_crossref_and_url_repair(self):
        self.pdf(metadata={"/doi": "10.1000/example", "/doiURL": "wrong"})
        item = {"DOI": "10.1000/example", "type": "journal-article", "title": ["Main title"], "subtitle": ["Subtitle"], "author": [{"family": "Smith"}], "published-print": {"date-parts": [[2025]]}}
        with patch("zotlink_pdf.crossref.fetch_crossref_item", return_value=item):
            result = run(self.path, "rename")
        renamed = Path(result["path"])
        self.assertEqual(renamed.name, "Smith 2025 Main title  Subtitle.pdf")
        self.assertFalse(self.path.exists())
        self.assertEqual(PdfReader(renamed).metadata["/doiURL"], "https://doi.org/10.1000/example")
        before = renamed.read_bytes(), renamed.stat().st_mtime_ns
        with patch("zotlink_pdf.crossref.fetch_crossref_item", return_value=item), \
             patch("pathlib.Path.rename", side_effect=AssertionError("already matched files must not rename")):
            repeated = run(renamed, "rename")
        self.assertFalse(repeated["renamed"])
        self.assertTrue(repeated["skipped"])
        self.assertIn("已与目标相符", repeated["message"])
        self.assertEqual((renamed.read_bytes(), renamed.stat().st_mtime_ns), before)

    def test_batch_deduplicates_and_reports_once_without_zotero(self):
        base = Path(self.directory.name)
        self.pdf(metadata={"/doi": "10.1000/example"})
        task = {"mode": "doi-metadata-only", "files": [str(self.path)], "silent": False}
        write_json(base / ("a" * 32 + ".pdf-task.json"), task)
        write_json(base / ("b" * 32 + ".pdf-task.json"), task)
        reports, notice = drain_tasks(base, idle_seconds=0.01)
        self.assertEqual(len(reports), 1)
        self.assertTrue(notice)
        # The runner uses only its own files; no Zotero process or IPC is required for processing.
        with patch("runner.notify") as notification:
            self.assertEqual(main(["--mode", "doi-metadata-only", str(self.path)], base=base), 0)
            notification.assert_called_once()
        self.assertFalse((base / "pdf-batch.lock").exists())
        self.assertEqual(len(json.loads((base / "pdf-report-latest.json").read_text(encoding="utf-8"))), 1)

    def test_two_independent_processes_share_batch_without_zotero(self):
        base = Path(self.directory.name)
        runtime = base / "runtime"
        shutil.copytree(BASE, runtime / "pdf", ignore=shutil.ignore_patterns("__pycache__"))
        self.pdf(metadata={"/doi": "10.1000/example"})
        other = base / "Another.pdf"
        shutil.copyfile(self.path, other)
        command = [sys.executable, str(runtime / "pdf" / "runner.py"), "--mode", "doi-metadata-only", "--no-dialog"]
        processes = [subprocess.Popen(command + [str(pdf)], cwd=base, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for pdf in [self.path, other]]
        for process in processes:
            output, error = process.communicate(timeout=30)
            self.assertEqual(process.returncode, 0, (output + error).decode(errors="replace"))
        reports = json.loads((runtime / "pdf-report-latest.json").read_text(encoding="utf-8"))
        self.assertEqual(len(reports), 2)
        self.assertFalse((runtime / "pdf-batch.lock").exists())
        for pdf in [self.path, other]:
            self.assertEqual(PdfReader(pdf).metadata["/doiURL"], "https://doi.org/10.1000/example")

    def test_book_editor_edition_and_path_limit(self):
        item = {"type": "book", "title": ["Main title"], "subtitle": ["x" * 300], "editor": [{"family": "Smith"}], "edition-number": 2, "created": {"date-parts": [[2020]]}}
        name = build_citation_filename(item, parent=self.path.parent)
        self.assertIn("(ed.)", name)
        self.assertIn("(2nd ed.)", name)
        self.assertLessEqual(len(str(self.path.parent / name)), 280)


if __name__ == "__main__":
    unittest.main()
