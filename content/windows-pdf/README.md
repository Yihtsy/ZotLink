# ZotLink Windows PDF Helpers

Applicable version: ZotLink 0.8.0.

- This is an independent snapshot adapted from Yihtsy's PDF-DOI tool source on 2026-10-15, distributed under the project's MIT license. It never imports the installed `pydfdoi` package or files from the neighboring project.
- Runtime: Windows Python 3 with its `pyw` launcher and standard tkinter, plus `pikepdf`, `pypdf`, and `requests`. Install dependencies with `py -3 -m pip install pikepdf pypdf requests`.
- The XPI releases these helpers to `%LOCALAPPDATA%\ZotLink\windows-menu\pdf` on startup and registers three PDF context commands under ZotLink. Commands also work when Zotero is closed; matching indexed links are reconciled on the next Zotero startup.
- DOI: `/doi` is authoritative, including an invalid existing value (which stops rather than rescans). `doiURL` does not identify the work. Only an absent `/doi` triggers page text extraction, up to 20 pages, without OCR.
- Page labels: conventional page ranges for components (articles, proceedings papers, chapters); skip whole-publication containers and article numbers. Text evidence infers the component start; additional pages use the existing front/back placement logic. An extra leading page is labeled `cover page`.
- Writes are staged and validated, then written through the original file to preserve its file ID. A rollback backup is retained if restoring a failed write also fails. Renames use file moves and never overwrite an existing PDF.
- The Python source is bundled; the interpreter and third-party dependencies are not. Network access is required for Crossref queries.
- Align PDF page labels also writes DOI metadata. Article-start inference reads at most three leading and three trailing pages, uses publisher/aggregator signatures and Crossref title/page evidence, and never extracts middle-page text. See PAGE_LABEL_FORMATS.md. Filename matches skip renaming; fully matching metadata skips rewriting.
- Nearby context invocations are collected by a file-based batch worker, which does not require Zotero to run. Completion uses an auto-closing, non-modal tkinter notice rather than a Windows message box.
