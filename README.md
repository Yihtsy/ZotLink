# ZotLink

[![release](https://img.shields.io/badge/release-v0.4.0-blue)](https://github.com/Yihtsy/ZotLink/releases/tag/v0.4.0)
[![license](https://img.shields.io/badge/license-MIT-orange)](LICENSE)
[![Zotero](https://img.shields.io/badge/Zotero-10-red)](https://www.zotero.org/)

ZotLink is a Windows attachment manager for Zotero 10 users who prefer linked attachments and want their PDFs to remain usable as ordinary files in ordinary folders.

ZotLink 是一个面向 Zotero 10 的 Windows 链接附件管理插件，主要服务于喜欢使用链接附件、希望 PDF 文件独立保存在普通文件夹中的用户。

ZotLink keeps PDFs in a readable folder structure, records stable file identity information, and helps Zotero recover when a linked PDF was renamed or moved outside Zotero.

ZotLink 会把 PDF 文件放在可直接浏览、可独立使用的文件夹体系中，同时记录稳定的文件身份信息，帮助 Zotero 在外部改名或移动 PDF 后重新找回附件。

Inspired by Obsidian's file-first philosophy, ZotLink follows one guiding principle: your literature files should remain understandable, portable, and independently usable even without Zotero, including in a future where Zotero is no longer part of your workflow.

受 Obsidian 文件优先理念的启发，ZotLink 坚持一个总的指导原则：文献文件应当始终清晰、可迁移，并且能够脱离 Zotero 独立使用；哪怕未来不再使用 Zotero，这些文件仍然属于用户自己的普通文件体系。

## Highlights 核心特性

- Move linked attachments into folders that mirror Zotero collection paths.
- 按 Zotero 分类层级移动链接附件。

- Convert copied Zotero storage file attachments into linked attachments under your configured folder root.
- 以复制形式进入 Zotero storage 的文件附件，会自动移出到指定顶层目录并改为链接附件。

- Track both Windows file ID and attachment path, so renamed or moved PDFs can still be repaired.
- 同时记录 Windows 机内码与附件路径，用于修复外部改名或移动后脱钩的 PDF。

- Repair both filename and folder changes. When a PDF is moved within the configured root, ZotLink updates the linked path and adds the item to the matching collection without removing any existing collection memberships. Files found outside the root are reported instead of being moved silently.
- 同时修复文件名和目录变化。PDF 在设定顶层路径内被外部移动后，ZotLink 会更新链接路径，并把条目加入新目录对应的分类，但不会移出任何现有分类；发现文件已移出顶层路径时只提示，不会擅自移动。

- Represent multi-collection items as one real PDF plus `.lnk` shortcut mirrors in the other collection folders.
- 一个条目属于多个分类时，保留一份真实 PDF，并在其他分类文件夹中创建 `.lnk` 快捷方式分身。

- Swap the real PDF location when you Shift-drag an item to another collection, then refresh shortcut mirrors.
- Shift+拖拽条目到其他分类时，可把真实 PDF 换位移动到新分类文件夹，并刷新其他快捷方式分身。

- Follow collection hierarchy changes recursively. When a collection is moved or renamed, PDFs and shortcut mirrors under it are synchronized to the new folder path.
- 递归跟随分类层级变化。移动分类或修改分类名称后，其中的 PDF 与快捷方式分身会同步到新的文件夹路径。

- Persist moves that are temporarily blocked by an open file and retry them automatically after the file is closed, including after restarting Zotero.
- 文件因正在打开而暂时无法移动时，会持久记录待处理任务；文件关闭后自动重试，重启 Zotero 后也会继续。

- Import PDFs from a collection folder, or rebuild a linked Zotero library from the whole configured folder root by reading PDF DOI or ISBN metadata.
- 支持从分类文件夹导入 PDF，也支持从配置的顶层文件夹递归读取 PDF DOI 或 ISBN 元数据，快速重建链接附件库。

- Write DOI metadata back into PDFs and correct `/doiURL` when it does not match `/doi`.
- 支持把 DOI 元数据写回 PDF，并在 `/doiURL` 与 `/doi` 不一致时自动纠正。

- Optionally rename a newly imported primary PDF from DOI metadata using the fixed citation form `Authors Year Main title  Subtitle`.
- 可选在主 PDF 首次导入时根据 DOI 元数据自动改名，固定采用 `作者引用形式 年份 主标题  副标题`。

- Align PDF page labels from Zotero item page ranges such as `10-18` or `S10-S18`.
- 支持根据 Zotero 条目的常规页码范围（如 `10-18`、`S10-S18`）对齐 PDF 页码标签。

- Extract journal article history dates from the primary PDF and write `Received:`, `Revised:`, `Accepted:`, and `Online:` lines into Zotero Extra.
- 支持从期刊文章主 PDF 中提取文章历史时间线，并写入 Zotero Extra 中的 `Received:`、`Revised:`、`Accepted:`、`Online:` 字段行。

- Copy the selected literature item's DOI URL with one context-menu command or a configurable shortcut, falling back to the item URL only when no DOI is available.
- 可通过右键命令或自定义快捷键复制所选文献的 DOI URL；仅在没有 DOI 时回退复制条目 URL。

## Basic Usage 使用方式

Install `zotlink-0.4.0.xpi` in Zotero, restart Zotero, and set the attachment root folder in ZotLink preferences, for example `D:\OneDrive\Zotero`.

在 Zotero 插件管理器中安装 `zotlink-0.4.0.xpi`，重启 Zotero，然后在 ZotLink 设置中填写附件顶层路径，例如 `D:\OneDrive\Zotero`。

Select Zotero items or attachments and use `ZotLink -> Move Attachments to Collection Folder` from the item context menu.

选中文献条目或附件后，可使用右键菜单 `ZotLink -> 移动附件到分类文件夹`。

Drag an item normally into another collection to keep the real PDF where it is and create a shortcut mirror in the new collection folder. Shift-drag an item to move the real PDF to the new collection folder and turn the old folder entry into a shortcut mirror.

普通拖拽条目到另一个分类时，真实 PDF 保持在原位置，并在新增分类文件夹中创建快捷方式分身。Shift+拖拽时，真实 PDF 会移动到新分类文件夹，原文件夹位置会变成快捷方式分身。

ZotLink preferences include instant checkboxes for automatic PDF processing during file operations. DOI/DOI URL metadata writing, page-label alignment, opening PDFs at the first page, and making PDF viewers show the filename are enabled by default. First-import citation renaming and article history extraction are disabled by default.

ZotLink 设置中提供文件操作自动处理勾选项，勾选后即时生效。DOI/DOI URL 元数据写入、页码标签对齐、打开 PDF 时定位首页、让 PDF 查看器显示文件名默认开启；首次导入自动改名与文章投稿历史识别默认关闭。

The `Update Entire Library Using Selected Options` button combines whole-library maintenance according to the checked options: filling missing file IDs, writing DOI metadata, aligning page labels, applying PDF viewer preferences, and extracting article history. First-import citation renaming remains limited to newly imported files. Rebuilding from the root folder remains a separate operation because it may create collections and Zotero items.

`按勾选项目更新全库`按钮会按照当前勾选项组合执行全库维护，包括补录缺失机内码、写入 DOI 元数据、对齐页码、更新 PDF 查看设置和提取文章历史。引用式改名仍然只用于首次导入。由于顶层文件夹重建可能创建分类和 Zotero 条目，因此继续作为独立操作保留。

## Features 功能介绍

### Multi-Collection Shortcut Mirrors 多重分类与快捷方式分身

Zotero binds one attachment item to one real file path, but one literature item may belong to multiple collections. ZotLink solves this by keeping a single real PDF and creating `.lnk` shortcut mirrors for the other collection folders.

Zotero 的一个附件条目只能绑定一个真实文件路径，但一个文献条目常常同时属于多个分类。ZotLink 的做法是保留一份真实 PDF，并为其他分类文件夹创建 `.lnk` 快捷方式分身。

ZotLink considered hard links, but did not choose them as the default strategy. Hard links can make the primary path unclear, are not always friendly in ordinary file managers or sync tools, and can make deletion semantics confusing. `.lnk` shortcuts make the model explicit: one real PDF, multiple visible entrances.

ZotLink 曾认真考虑硬链接方案，但最终没有把它作为默认方式。硬链接会让主路径不直观，在普通文件管理器和同步盘中也未必符合用户预期，删除语义也容易混淆。`.lnk` 快捷方式更明确：真实 PDF 只有一份，其他位置只是入口和分身。

### Collection Tree Moves and Safe Folder Merges 分类树移动与安全文件夹合并

When a Zotero collection is renamed or moved under another collection, ZotLink moves the corresponding folder tree first and then rebuilds linked-attachment paths for items below it. Files that exist in the folder but are not yet represented by Zotero items move with the folder as well, so the ordinary filesystem remains the complete source of truth.

当 Zotero 分类改名或移动到另一个分类下时，ZotLink 会先移动对应的完整文件夹树，再重建其下属条目的链接附件路径。即使文件夹里还有尚未纳入 Zotero 的文件，也会随整个目录一起移动，使普通文件系统继续保留完整内容。

If a same-named destination folder already exists, ZotLink moves and merges the source contents instead of copying them. The old folder is removed only after ZotLink confirms that it no longer represents an active collection, is empty, and is still the exact source folder recorded for that move. OneDrive read-only directory attributes are handled only at this final empty-folder cleanup step.

如果目标位置已经有同名文件夹，ZotLink 会移动并合并源目录内容，而不是复制文件。只有确认旧路径不再对应有效分类、目录确实为空，并且仍是本次移动记录的那个源文件夹时，才会删除旧目录。OneDrive 的只读目录属性也只在最后这个空目录清理步骤中处理。

Moves blocked by an open PDF are kept in a persistent retry queue. ZotLink retries after the file is closed and continues unfinished moves after Zotero restarts.

如果 PDF 正在打开而暂时无法移动，任务会进入持久重试队列；文件关闭后自动重试，重启 Zotero 后也会继续完成。

### Root Folder Library Rebuild 顶层文件夹重建链接库

The preference button `Rebuild Linked Library from Root Folder` first reconciles collection and folder structure in both directions: existing collections create missing folders, and existing folders create missing collections. Within the same parent collection, ZotLink reuses an existing child collection with the same name instead of creating duplicates. It then recursively scans PDFs, reads DOI or ISBN metadata, skips identifiers already present in the Zotero library, and adds the PDFs as linked attachments.

设置页按钮 `从顶层文件夹重建链接库` 会先双向对齐分类与文件夹结构：已有分类但没有对应文件夹时创建文件夹；已有文件夹但没有对应分类时创建分类。同一个父分类下如果已有同名子分类，ZotLink 会复用它，不会重复创建。随后再递归扫描 PDF、读取 DOI 或 ISBN metadata、跳过 Zotero 库中已有标识符，并将 PDF 作为链接附件加入 Zotero。

This is designed for users who manage PDFs directly in a cloud-synced folder such as OneDrive. After moving to another computer, the same folder structure can be used to quickly rebuild Zotero linked attachments.

这个功能面向喜欢直接管理文件夹和文件的用户，尤其适合把 PDF 放在 OneDrive 等第三方同步盘中特定目录的人。跨机器迁移后，只要文件夹结构保持一致，就可以快速重建 Zotero 的链接附件关系。

### Collection Folder PDF Import 从分类文件夹导入 PDF

From the left collection context menu, ZotLink can import PDFs from the selected collection folder only, or recursively import subfolders and create matching child collections.

在左侧分类的右键菜单中，ZotLink 可以只导入当前分类对应文件夹中的 PDF，也可以递归导入子文件夹并创建匹配的子分类。

Collection-folder imports show an immediate ZotLink soft notification when they start. If another collection import is already running, repeated clicks are ignored and ZotLink reports that the import is still in progress.

分类文件夹导入开始时会立即显示 ZotLink 软提示。如果已有 collection 导入任务正在进行，重复点击不会启动第二个任务，ZotLink 会提示当前导入仍在进行中。

When a collection-folder import finishes, ZotLink reports newly created items, existing items added to the target collection, skipped PDFs, and total elapsed time. By default this uses a soft notification; ZotLink preferences can switch the completion report to a confirmation dialog.

分类文件夹导入完成时，ZotLink 会汇报新建条目数、已归入目标分类的已有条目数、跳过的 PDF 数和总耗时。默认使用软提示；也可以在 ZotLink 设置中改为确认弹窗。

Collection-folder imports first try a fast Windows file-ID match against ZotLink's existing attachment index. If a PDF is already known to ZotLink, ZotLink skips PDF metadata reading and only adds the existing item to the target collection when needed. Files not found by file ID fall back to DOI/ISBN metadata matching against the whole Zotero library. For book items, ZotLink expands multi-line, space-separated, or hyphenated Zotero ISBN fields into individual normalized ISBN values, including ISBN-10/ISBN-13 equivalents when possible, before matching.

分类文件夹导入会先用 Windows 机内码快速匹配 ZotLink 已记录的附件索引。如果这个 PDF 已被 ZotLink 认识，ZotLink 会跳过 PDF metadata 读取，只在需要时把已有条目加入目标分类。机内码未命中的文件再回退到 DOI/ISBN metadata，并按整个 Zotero 库查重。对于图书条目，ZotLink 会先把 Zotero 中多行、空格分隔或带连字符的 ISBN 字段拆成多个标准化 ISBN，并在可转换时同时登记 ISBN-10/ISBN-13 等价形式后再匹配。

ZotLink reads DOI values from PDF Info/XMP metadata fields such as `doi`, `DOI`, `prism:doi`, and `dc:identifier`. If no DOI is found, it reads ISBN metadata fields such as `isbn`, `ISBN`, `prism:isbn`, and `dc:identifier`, normalizes hyphenated ISBN-13, plain ISBN-13, and ISBN-10 values, and then uses Zotero's native identifier-search path to create full Zotero items. PDFs without DOI or ISBN metadata fields are skipped quickly.

ZotLink 会读取 PDF Info/XMP metadata 中的 `doi`、`DOI`、`prism:doi`、`dc:identifier` 等 DOI 字段；如果没有 DOI，则继续读取 `isbn`、`ISBN`、`prism:isbn`、`dc:identifier` 等 ISBN 字段，并预处理带连字符的 ISBN-13、纯 13 位 ISBN 和 ISBN-10，再走 Zotero 原生标识符搜索路径创建完整条目。没有 DOI 或 ISBN metadata 字段的 PDF 会快速跳过。

### PDF DOI Metadata and Page Labels PDF DOI 元数据与页码标签

ZotLink can write `/doi` and `/doiURL` into PDF metadata. If `/doi` already exists, it is treated as authoritative; if `/doiURL` is missing or inconsistent, ZotLink rewrites `/doiURL` from `/doi`.

ZotLink 可以把 `/doi` 与 `/doiURL` 写入 PDF metadata。如果 PDF 已经存在 `/doi`，则以 `/doi` 为准；如果 `/doiURL` 缺失或不一致，ZotLink 会按 `/doi` 重写 `/doiURL`。

ZotLink can also write PDF page labels from the parent Zotero item's `pages` field, but only for conventional ranges such as `10-18` or `S10-S18`. Article numbers and page values without a hyphen are skipped.

ZotLink 也可以根据父条目的 `pages` 字段写入 PDF 页码标签，但只处理 `10-18`、`S10-S18` 这类常规范围。文章号或没有连字符的页码值会被跳过。

### First-Import Citation Renaming 首次导入引用式改名

There are two ways to rename attachment files. Zotero's built-in renaming can use a user-defined combination of item fields and is suitable when a customizable naming template is preferred. ZotLink provides a separate fixed citation-style rule for users who want consistent filenames without maintaining a field template.

目前有两种附件文件改名方式。Zotero 自带的改名功能可以由用户自由组合条目字段，适合希望自定义命名模板的工作流。ZotLink 另外提供一套固定的引用式规则，适合希望文件名保持统一、又不想维护字段组合模板的用户。

When `Rename the primary PDF from citation information on first import` is checked in ZotLink preferences, newly imported primary PDFs use ZotLink's rule by default: `Authors Year Main title  Subtitle`. One author uses the family name, two authors use `A & B`, and three or more use `A et al.`. The main title and subtitle are separated by two spaces.

在 ZotLink 设置中勾选“首次导入时按引用信息重命名主 PDF”后，新导入的主 PDF 默认采用 ZotLink 的固定规则：`作者引用形式 年份 主标题  副标题`。一位作者使用姓，两位作者使用 `A & B`，三位及以上使用 `A et al.`，主标题与副标题之间使用两个空格。

When this option is not checked, ZotLink does not rename newly imported PDFs, and Zotero's built-in customizable renaming can be used instead.

未勾选该选项时，ZotLink 不会对新导入的 PDF 改名，用户仍可改用 Zotero 自带的可自定义改名功能。

If the filename already matches, ZotLink leaves it untouched. The complete path is limited to 280 characters; when the full form is too long, ZotLink omits the subtitle. If the main-title form is still too long, renaming is skipped.

如果文件名已经符合规则，ZotLink 不会重复改名。完整路径限制为 280 字符；完整形式超长时会舍弃副标题，若仅保留主标题仍然超长，则跳过改名。

### Quick Literature Link Copy 快速复制文献链接

Select one literature item, or one of its attachments, and choose `ZotLink -> Copy DOI/URL Link`. A configurable shortcut is available at the bottom of ZotLink preferences. ZotLink always prefers a normalized `https://doi.org/...` link; the Zotero item URL is copied only when the item has no valid DOI.

选中一篇文献条目或其附件后，可以使用 `ZotLink -> 复制 DOI/URL 链接`。ZotLink 设置页底部可以配置对应快捷键。插件始终优先复制标准化的 `https://doi.org/...` 链接；只有条目没有有效 DOI 时，才会复制 Zotero 条目的 URL。

ZotLink can also copy an Obsidian-oriented Markdown snippet with a DOI/URL link and a Zotero PDF link, for example `[🔗](https://doi.org/10.1055/s-0039-3400972) [📚](zotero://open-pdf/library/items/QHLRZNGU)`. This command has its own context-menu entry and shortcut.

ZotLink 也可以复制面向 Obsidian 的 Markdown 片段，同时包含 DOI/URL 链接和 Zotero PDF 链接，例如 `[🔗](https://doi.org/10.1055/s-0039-3400972) [📚](zotero://open-pdf/library/items/QHLRZNGU)`。这一命令有独立的右键菜单项和快捷键。

This is intended for fast linking in Obsidian and similar note-taking applications: select existing text in a note, invoke the ZotLink shortcut in Zotero, return to the note, and paste the copied literature link to turn the selected text into a link using the note application's normal paste behavior.

这一功能主要用于在 Obsidian 等笔记软件中快速插入文献链接：在笔记中拖选已有文字，通过 ZotLink 快捷键复制文献链接，返回笔记后粘贴，即可利用笔记软件原有的粘贴行为把所选文字转换为链接。

### Article History Fields 文章历史时间线字段

For English journal article items, ZotLink can read the primary PDF and extract article history dates such as received, revised, accepted, and online publication dates. The results are written into Zotero Extra as `Received: YYYY-MM-DD`, `Revised: YYYY-MM-DD`, `Accepted: YYYY-MM-DD`, and `Online: YYYY-MM-DD`, and ZotLink also exposes them as dedicated item-info rows when Zotero supports custom info rows.

对于英文期刊文章条目，ZotLink 可以读取主 PDF，提取收稿、修订、录用和在线发表等文章历史时间线，并以 `Received: YYYY-MM-DD`、`Revised: YYYY-MM-DD`、`Accepted: YYYY-MM-DD`、`Online: YYYY-MM-DD` 的形式写入 Zotero Extra；在 Zotero 支持自定义信息栏字段时，ZotLink 也会把它们显示为独立信息栏行。

The extractor checks the first four and last four PDF pages. Existing history fields are treated as user-corrected values and are never overwritten; automatic extraction only fills fields that are still missing.

提取器会检查 PDF 的前四页与后四页。已有文章历史字段视为用户确认或修正过的值，自动识别绝不覆盖，只补充仍然缺失的字段。

### Planned Crossref Metadata Repair 计划中的 Crossref 元数据修复

ZotLink plans to absorb the part of Linter-style workflows that matter most for linked-PDF management: using an item's DOI to query Crossref and refresh publication metadata such as date, volume, issue, and pages. The pain point is that DOI-based imports and publisher metadata are often incomplete or inconsistent; ZotLink will treat Crossref lookup as a focused repair step rather than a general-purpose linting system.

ZotLink 后续计划吸收 Linter 类工作流中最适合链接附件管理的一部分：通过条目的 DOI 查询 Crossref，并更新日期、Volume、Issue 和页码等出版信息。痛点在于 DOI 导入和出版社元数据常常不完整或不一致；ZotLink 会把 Crossref 查询作为聚焦的修复步骤，而不是做成完整的通用 Linter 系统。

The extractor currently follows patterns tested from the earlier `handytool.pdf.extract_article_history` prototype and records known publisher layouts in [ARTICLE_HISTORY_FORMATS.md](ARTICLE_HISTORY_FORMATS.md).

当前提取器参考了早期 `handytool.pdf.extract_article_history` 原型中已经验证过的思路；已知出版社排版格式记录在 [ARTICLE_HISTORY_FORMATS.md](ARTICLE_HISTORY_FORMATS.md)。

### Index Data 索引数据

ZotLink stores its attachment index in Zotero preferences under `extensions.zotlink.attachmentFileIndex`.

ZotLink 将附件索引存储在 Zotero preferences 中：`extensions.zotlink.attachmentFileIndex`。

The index records Windows file ID, primary path, shortcut mirror paths, and compatibility fields for older hard-link experiments.

索引会记录 Windows 机内码、主路径、快捷方式分身路径，以及旧硬链接实验模式的兼容字段。

The preferences separate file identity maintenance from PDF content processing. `Check and Repair All Attachment Links` first fills missing file IDs and repairs offline filename or folder changes. `Update Library Using Selected Operations` then performs only the enabled PDF metadata and document operations. Bulk PDF processing and root-folder rebuilding both verify links before working on files.

设置页将文件身份维护与 PDF 内容处理分开：`检查并修复全库附件链接`负责补录缺失机内码，并修复 Zotero 关闭期间发生的文件改名或移动；`按勾选项目更新全库`只执行已启用的 PDF 元数据与文档操作。全库 PDF 处理和顶层文件夹重建都会先核对附件链接。

## Why ZotLink 为什么做 ZotLink

Zotero linked attachments store a path. If a user renames or moves PDFs in File Explorer, Everything, OneDrive, or another file manager, Zotero can lose the link even though the PDF still exists. ZotLink tries to make Zotero and the external file system cooperate instead of forcing one side to fully own the other.

Zotero 链接附件记录的是路径。用户如果在资源管理器、Everything、OneDrive 或其他文件管理器中重命名、移动 PDF，PDF 明明还在，Zotero 却可能脱钩。ZotLink 的目标是让 Zotero 与外部文件系统协作，而不是让其中一方完全接管另一方。

This is also why ZotLink treats the folder structure and PDF files as durable user data, while Zotero acts as a powerful catalog and reading environment built on top of them. The library should survive application changes, computer migrations, and cloud-sync choices without being trapped inside one application's private storage layout.

这也是 ZotLink 把文件夹结构与 PDF 文件视为长期用户数据的原因，而 Zotero 则是建立在其上的强大编目与阅读环境。文献库不应被困在某个软件的私有存储结构中；即使更换软件、迁移电脑或改变网盘方案，文件本身仍应保持可读、可找、可继续使用。

Compared with [ZotMoov](https://github.com/wileyyugioh/zotmoov), ZotLink emphasizes moving files rather than copy-and-delete workflows, and records Windows file ID for repair. Compared with [Attanger](https://github.com/MuiseDestiny/zotero-attanger), ZotLink is narrower and more focused on linked-file identity, collection-folder mapping, and multi-collection shortcut mirrors. [ZotFile](https://github.com/jlegewie/zotfile) is the classic predecessor; ZotLink focuses on a Zotero 10 linked-attachment workflow.

与 [ZotMoov](https://github.com/wileyyugioh/zotmoov) 相比，ZotLink 更强调移动文件而不是复制后删除，并记录 Windows 机内码用于修复。与 [Attanger](https://github.com/MuiseDestiny/zotero-attanger) 相比，ZotLink 的定位更窄，更聚焦链接文件身份、分类文件夹映射和多分类快捷方式分身。[ZotFile](https://github.com/jlegewie/zotfile) 是经典前辈；ZotLink 则聚焦 Zotero 10 的链接附件工作流。

## Notes 注意事项

ZotLink is currently Windows-oriented because Windows file ID, `.lnk` shortcuts, and NTFS move semantics are central to its workflow.

ZotLink 当前主要面向 Windows，因为 Windows 机内码、`.lnk` 快捷方式和 NTFS 移动语义都是核心工作流的一部分。

ZotLink is intended for linked attachments. If you prefer Zotero storage file attachments and want PDFs to stay inside Zotero storage, ZotLink may not fit your workflow.

ZotLink 面向链接附件工作流。若你偏好 Zotero storage 文件附件，并希望 PDF 始终留在 Zotero storage 内，本插件可能不适合你的工作流。

PDF metadata writing modifies PDF source files. Back up your attachment folder before running whole-library operations for the first time.

PDF metadata 写回会修改 PDF 源文件。首次执行全库操作前，建议备份附件目录。

## Version Log 版本记录

See [VERSION_LOG.md](VERSION_LOG.md).

详见 [VERSION_LOG.md](VERSION_LOG.md)。

## User Manual 功能手册

For a complete numbered reference to every ZotLink feature, trigger, behavior, and limitation, see [USER_MANUAL.md](USER_MANUAL.md). Feature IDs such as `A2`, `C4`, and `F3` are kept stable so they can be used in issue reports and future discussions.

有关 ZotLink 各项功能、触发条件、实际行为与限制的完整编号说明，请参阅 [USER_MANUAL.md](USER_MANUAL.md)。`A2`、`C4`、`F3` 等功能编号会保持稳定，便于问题反馈和后续讨论时直接定位。
