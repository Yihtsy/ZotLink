"""Windows PDF context commands bundled with ZotLink, independent of pydfdoi."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path
from uuid import uuid4


def notify(text: str) -> None:
    """A bottom-right, auto-closing notice without a modal confirmation."""
    if os.name != "nt":
        return
    import tkinter as tk
    from tkinter import ttk
    window = tk.Tk()
    window.withdraw()
    window.overrideredirect(True)
    window.attributes("-topmost", True)
    frame = ttk.Frame(window, padding=14, relief="solid", borderwidth=1)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="ZotLink", font=("Segoe UI", 11, "bold")).pack(anchor="w")
    ttk.Label(frame, text=text, wraplength=470, justify="left").pack(anchor="w", pady=(8, 0))
    window.update_idletasks()
    width, height = window.winfo_reqwidth(), window.winfo_reqheight()
    x = max(0, window.winfo_screenwidth() - width - 18)
    y = max(0, window.winfo_screenheight() - height - 64)
    window.geometry(f"{width}x{height}+{x}+{y}")
    window.bind("<Button-1>", lambda event: window.destroy())
    window.after(8000, window.destroy)
    window.deiconify()
    window.mainloop()


def run(path: Path, mode: str) -> dict:
    from zotlink_pdf.pdf import extract_doi, write_pdf_metadata
    from zotlink_pdf.citation import build_citation_filename, unique_path
    from zotlink_pdf.crossref import fetch_crossref_item, is_whole_book_type
    from zotlink_pdf.page_labels import update_pdf_page_labels_from_crossref
    from pypdf import PdfReader
    import re

    if path.suffix.lower() != ".pdf" or not path.is_file():
        raise ValueError("请选择有效的 PDF 文件")
    doi = extract_doi(path, max_pages=20)
    if not doi:
        return {"ok": True, "skipped": True, "path": str(path), "message": "未发现 DOI，跳过（仅扫描前 20 页，不执行 OCR）"}
    item = None
    if mode != "doi-metadata-only":
        item = fetch_crossref_item(doi)
        if not item or str(item.get("DOI", "")).casefold() != doi.casefold():
            raise ValueError("Crossref 无匹配记录或返回了不同 DOI，未修改文件")
    if mode == "page-labels":
        plan = update_pdf_page_labels_from_crossref(path, doi=doi, crossref_item=item, max_pages=20)
        metadata_changed = write_pdf_metadata(path, doi)
        labels_changed = plan is not None and not plan.already_aligned
        message = "无常规页码范围或属于整本书/容器，跳过页码对齐" if plan is None else "页码已对齐，无需重复修改" if plan.already_aligned else "页码已对齐"
        if metadata_changed:
            message += "；已写入或修正 DOI 元数据"
        if plan and plan.source.endswith("front-fallback"):
            message += "；首尾线索不足，按前置页规则处理"
        return {"ok": True, "skipped": not (metadata_changed or labels_changed), "changed": metadata_changed or labels_changed,
                "path": str(path), "doi": doi, "message": message}
    target = path
    if mode == "rename":
        copyright_year = None
        if is_whole_book_type(item.get("type")):
            reader = PdfReader(str(path))
            for page in reader.pages[:20]:
                match = re.search(r"©\s*(?:copyright(?:ed)?(?:\s+in)?\s*)?((?:18|19|20|21)\d{2})", page.extract_text() or "", re.I)
                if match:
                    copyright_year = int(match[1])
                    break
        filename = build_citation_filename(item, doi=doi, parent=path.parent, year_override=copyright_year)
        target = path.with_name(filename)
        if target != path and target.exists():
            target = unique_path(target)
        # Validate the filename before modifying the source PDF.
        if len(str(target)) > 280 or len(target.name) > 255:
            raise ValueError("含重名后缀的目标路径超过长度限制，未修改文件")
    metadata_changed = write_pdf_metadata(path, doi, title=target.stem)
    renamed = target != path
    if target != path:
        path.rename(target)
    message = "已重命名" if renamed else "文件名已与目标相符，不做重命名" if mode == "rename" else "元数据已更新" if metadata_changed else "元数据已符合要求，无需修改"
    if mode == "rename" and not renamed and metadata_changed:
        message += "；已更新 DOI 元数据"
    return {"ok": True, "skipped": not (metadata_changed or renamed), "changed": metadata_changed or renamed,
            "renamed": renamed, "path": str(target), "oldPath": str(path), "doi": doi, "message": message}


def process_files(files: list[str], mode: str, base: Path) -> list[dict]:
    reports = []
    for filename in files:
        result = process_one(filename, mode, base)
        reports.append(result)
    return reports


def process_one(filename: str, mode: str, base: Path) -> dict:
    import hashlib
    path = Path(filename).resolve()
    lock = base / ("pdf-" + hashlib.sha256(str(path).casefold().encode()).hexdigest() + ".lock")
    acquired = False
    try:
        with lock.open("x", encoding="utf-8") as stream:
            stream.write(str(os.getpid()))
        acquired = True
        result = run(path, mode)
    except FileExistsError:
        result = {"ok": False, "path": str(path), "message": "目标文件已被另一个操作创建，请重试改名" if acquired else
                  "该 PDF 已有任务在进行中；若上次异常中断，请重新加载 ZotLink 清理任务锁"}
    except ModuleNotFoundError as error:
        result = {"ok": False, "path": str(path), "message": f"缺少 Python 依赖：{error.name}。请运行 py -3 -m pip install pikepdf pypdf requests"}
    except Exception as error:
        result = {"ok": False, "path": str(path), "message": str(error), "detail": traceback.format_exc()}
    finally:
        if acquired:
            lock.unlink(missing_ok=True)
    if result.get("ok") and not result.get("skipped"):
        event = {"createdAt": int(time.time() * 1000), "path": result["path"], "oldPath": str(path)}
        write_json(base / f"{uuid4().hex}.pdf-result.json", event)
    return result


def write_json(path: Path, value: object) -> None:
    temporary = path.with_name(uuid4().hex + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def drain_tasks(base: Path, idle_seconds: float = 0.8) -> tuple[list[dict], bool]:
    reports = []
    show_notice = False
    last_activity = time.monotonic()
    seen = set()
    while True:
        tasks = sorted(base.glob("*.pdf-task.json"))
        for task in tasks:
            try:
                data = json.loads(task.read_text(encoding="utf-8"))
                if data.get("mode") not in {"doi-metadata-only", "rename", "page-labels"}:
                    raise ValueError("未知 PDF 操作")
                show_notice = show_notice or not data.get("silent", False)
                for filename in data["files"]:
                    key = (str(Path(filename).resolve()).casefold(), data["mode"])
                    if key in seen:
                        continue
                    seen.add(key)
                    reports.extend(process_files([filename], data["mode"], base))
            except Exception as error:
                reports.append({"ok": False, "path": str(task), "message": str(error)})
            finally:
                task.unlink(missing_ok=True)
            last_activity = time.monotonic()
        if time.monotonic() - last_activity >= idle_seconds:
            return reports, show_notice
        time.sleep(min(0.1, idle_seconds))


def main(argv: list[str] | None = None, base: Path | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["doi-metadata-only", "rename", "page-labels"])
    parser.add_argument("--no-dialog", action="store_true")
    parser.add_argument("files", nargs="+")
    args = parser.parse_args(argv)
    started = time.monotonic()
    reports = []
    base = base or Path(__file__).resolve().parent.parent
    write_json(base / f"{uuid4().hex}.pdf-task.json", {"mode": args.mode, "files": args.files, "silent": args.no_dialog})
    batch_lock = base / "pdf-batch.lock"
    show_notice = False
    while True:
        try:
            with batch_lock.open("x", encoding="utf-8") as stream:
                stream.write(str(os.getpid()))
        except FileExistsError:
            return 0
        try:
            batch, notice = drain_tasks(base)
            reports.extend(batch)
            show_notice = show_notice or notice
        finally:
            batch_lock.unlink(missing_ok=True)
        # Recheck after releasing the lock so tasks arriving at batch completion are not orphaned.
        if not next(base.glob("*.pdf-task.json"), None):
            break
    write_json(base / "pdf-report-latest.json", reports)
    failed = sum(not item.get("ok") for item in reports)
    skipped = sum(item.get("ok") and item.get("skipped", False) for item in reports)
    message = f"处理 {len(reports)} 个 PDF：完成 {len(reports) - failed - skipped}，跳过 {skipped}，异常 {failed}。\n"
    message += "\n".join(f"{Path(item['path']).name[:90]}：{item['message']}" for item in reports[:4])
    if len(reports) > 4:
        message += "\n其余结果见 pdf-report-latest.json。"
    message += f"\n耗时 {time.monotonic() - started:.1f} 秒。"
    if show_notice:
        try:
            notify(message)
        except Exception:
            # Notification availability must not change a completed PDF task into a failure.
            pass
    return 0 if all(item.get("ok") for item in reports) else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        try:
            notify(traceback.format_exc()[-1500:])
        except Exception:
            pass
        sys.exit(1)
