# Article History Extraction Notes

This document records known publisher/layout patterns for extracting journal article history dates into Zotero Extra fields:

```text
Received: YYYY-MM-DD
Revised: YYYY-MM-DD
Accepted: YYYY-MM-DD
Online: YYYY-MM-DD
```

The ZotLink implementation is intentionally conservative: it reads the main PDF of journal article items, extracts text from the first four and last four pages, then fills only missing values among the four recognized Extra lines. Existing values and all other Extra content are preserved.

## Elsevier

Common layout, especially on the first page:

```text
Received 12 May 2023
Received in revised form 18 July 2023
Accepted 20 July 2023
Available online 26 July 2023
```

Mapped fields:

- `Received` -> `Received`
- `Received in revised form` -> `Revised`
- `Accepted` -> `Accepted`
- `Available online` -> `Online`

## General English Journal Layouts

Observed or supported labels:

- `Received`
- `Revised`
- `Revision received`
- `Received in revised form`
- `Accepted`
- `Accepted in final form`
- `Accepted in final revised form`
- `Accepted for publication`
- `First published online`
- `Published online`
- `Published online on`
- `Available online`
- `Online publication`
- `Online`

Late-page layouts are also supported, including compact forms such as:

```text
Received: 23 March 2022 Accepted: 23 November 2022
published online: 14 December 2022
```

Supported date forms:

- `12 May 2023`
- `May 12, 2023`
- `2023-05-12`
- `12/05/2023`
- `05/12/2023`

For ambiguous slash dates where both the first and second number are `<= 12`, ZotLink currently treats the first number as day. This favors many journal article layouts but should be revisited if a publisher consistently uses US month/day/year formatting.

## 中文备注

本文档用于记录不同出版社、不同年份 PDF 排版中“收稿、修订、录用、在线发表”时间线的写法。后续如果发现某个出版社在某一年之后发生排版变化，可以在这里按出版社继续补充样例。

当前实现主要模仿 `handytool.pdf.extract_article_history` 的思路：用 PyMuPDF/fitz 读取 PDF 页面文本，再用标签和日期正则提取字段。ZotLink 不直接依赖 `handytool` 包。
