# PDF Page Label Clues 出版社附加页线索

Applicable version: 0.8.0. Recorded 2026-10-15. These are initial heuristics, not universal publisher layout guarantees. The regression cases use synthetic text; publication-year boundaries and historical layout changes have not yet been verified against real PDFs.

适用版本：0.8.0。记录日期：2026-10-15。以下是初始启发式线索，不代表所有出版社版本都遵循同一格式。回归案例使用合成文字；真实 PDF 的适用年份及历史排版变化尚待逐例确认，不推定年份边界。

| Source 来源 | Position 位置 | Initial clues 初始线索 |
|---|---|---|
| Taylor & Francis / Routledge / Informa; DOI 10.1080 | Leading pages 前置页 | Source identifier plus both “To cite this article” and “To link to this article”, or full terms of access. 来源标识结合引用与链接指引，或访问条款。 |
| JSTOR; DOI 10.2307 or page identifier | Leading pages 首页 | JSTOR together with stable URL or usage terms. JSTOR 标识结合稳定链接或使用条款。 |
| ProQuest | Trailing pages 尾页 | ProQuest together with reproduction permission, prohibition or copyright. ProQuest 标识结合复制许可、禁止复制或版权声明。 |
| EBSCO | Trailing pages 尾页 | EBSCO and copyright together with copying/permission or individual-use language. EBSCO、版权标识结合复制许可或个人使用条款。 |

## Bounded Search 有限范围定位

- Read at most the first three and last three pages, and only when the PDF has more pages than the Crossref range. No middle-page text extraction.
- 只有 PDF 比 Crossref 常规页码范围多出页面时，最多读取前 3 页与后 3 页，不提取中间页文字。
- Locate the first actual content page using its title, abstract/introduction cues and printed start/end page labels. A cover may quote the title and DOI, so recognized covers do not contribute article-start votes.
- 用标题、摘要或引言线索及起止印刷页码定位正文第一页。封面可能引用题名及 DOI，因此已识别的封面不参与正文起始投票。
- One detected cover establishes a lower bound only: a second sparse cover may follow it. Do not assume the next page starts the article.
- 识别出一张封面只表示正文不早于它，后面可能还有信息稀少的前置页，不能直接把下一页当作正文。
- If evidence is insufficient, retain the existing all-extra-pages-at-front fallback and disclose it in the result. Interleaved inserts, reordered pages and historical layouts require additional evidence.
- 线索不足时保留原先将多余页面视为前置页的回退，并在结果中说明。正文内部插页、页面乱序及历史版式需要更多证据。
