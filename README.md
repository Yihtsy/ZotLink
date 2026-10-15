# ZotLink

[![release](https://img.shields.io/badge/release-v0.8.0-blue)](https://github.com/Yihtsy/ZotLink/releases/tag/v0.8.0)
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

- Register standalone Windows PDF context commands for DOI metadata, citation renaming and page labels; these work after Zotero is closed. Folder context navigation and structure-only subcollection rebuilding connect the file system to Zotero collections.
- 自动注册 Windows PDF 右键命令，用于 DOI 元数据、引用式改名和页码标签，Zotero 关闭后仍可使用；文件夹右键定位和仅重建子分类结构功能连接普通文件体系与 Zotero 分类。

- Copy the selected literature item's DOI URL with one context-menu command or a configurable shortcut, falling back to the item URL only when no DOI is available.
- 可通过右键命令或自定义快捷键复制所选文献的 DOI URL；仅在没有 DOI 时回退复制条目 URL。

## Basic Usage 使用方式

Install `zotlink-0.8.0.xpi` in Zotero, restart Zotero, and set the attachment root folder in ZotLink preferences, for example `D:\OneDrive\Zotero`.

在 Zotero 插件管理器中安装 `zotlink-0.8.0.xpi`，重启 Zotero，然后在 ZotLink 设置中填写附件顶层路径，例如 `D:\OneDrive\Zotero`。

Select Zotero items or attachments and use `ZotLink -> Move Attachments to Collection Folder` from the item context menu.

选中文献条目或附件后，可使用右键菜单 `ZotLink -> 移动附件到分类文件夹`。

Drag an item normally into another collection to keep the real PDF where it is and create a shortcut mirror in the new collection folder. Shift-drag an item to move the real PDF to the new collection folder and turn the old folder entry into a shortcut mirror.

普通拖拽条目到另一个分类时，真实 PDF 保持在原位置，并在新增分类文件夹中创建快捷方式分身。Shift+拖拽时，真实 PDF 会移动到新分类文件夹，原文件夹位置会变成快捷方式分身。

ZotLink preferences separate single-file automatic processing from whole-library updates, with independently saved checkboxes. Single-file DOI metadata, page-label alignment and viewer preferences remain enabled by default; first-import citation renaming is off. Whole-library updates enable only DOI metadata by default; page-label and viewer changes are off to limit unnecessary bulk processing.

ZotLink 设置分为“单文件自动处理”和“全库更新项目”，两组勾选独立保存、即时生效。单文件的 DOI 元数据、页码对齐和查看设置默认开启，首次导入改名默认关闭。全库默认仅开启 DOI 元数据，页码及查看设置默认关闭，以减少不必要的批量处理。

The first row of the whole-library section places rebuilding the linked library from the root on the left and checking/repairing all attachment links on the right. Bulk PDF updates use the independent checkboxes below. First-import renaming remains a single-file operation. Article history extraction, its date fields, settings and actions now belong entirely to ZotFields (formerly Zotero Literature Fields); existing Extra dates are preserved.

全库区域第一行左侧为“从顶层文件夹重建链接库”，右侧为“检查并修复全库附件链接”，下方使用独立勾选项更新 PDF。首次导入改名仍仅用于单文件。文章投稿历史提取、四个日期字段、设置和操作入口已完整迁移至 ZotFields（原 Zotero Literature Fields），已有 Extra 日期保留不变。

## Features 功能介绍

### Multi-Collection Shortcut Mirrors 多重分类与快捷方式分身

Renaming a collection also renames its mapped folder and updates attachment links. Shortcut mirrors preserve filenames containing straight or typographic apostrophes.

修改分类名称时，对应文件夹同步改名并更新附件链接。快捷方式分身支持含普通单引号或英文弯引号的文件名，保留原始名称。

Zotero binds one attachment item to one real file path, but one literature item may belong to multiple collections. ZotLink solves this by keeping a single real PDF and creating `.lnk` shortcut mirrors for the other collection folders.

Zotero 的一个附件条目只能绑定一个真实文件路径，但一个文献条目常常同时属于多个分类。ZotLink 的做法是保留一份真实 PDF，并为其他分类文件夹创建 `.lnk` 快捷方式分身。

Think of this as the body-and-double swap of Yuan'ge or Kongkong'er in Honor of Kings: the real PDF is the body, shortcuts are its doubles, and swapping relocates the body while keeping the other entrances pointing to it. There is still only one real PDF, not multiple independent copies.

可以类比《王者荣耀》中元歌或空空儿的本体与分身换位：真实 PDF 是本体，快捷方式是分身；换位时移动本体，并让其他入口继续指向它。真实文件始终只有一份，而不是多份独立副本。

ZotLink considered hard links, but did not choose them as the default strategy. Hard links can make the primary path unclear, are not always friendly in ordinary file managers or sync tools, and can make deletion semantics confusing. `.lnk` shortcuts make the model explicit: one real PDF, multiple visible entrances.

ZotLink 曾认真考虑硬链接方案，但最终没有把它作为默认方式。硬链接会让主路径不直观，在普通文件管理器和同步盘中也未必符合用户预期，删除语义也容易混淆。`.lnk` 快捷方式更明确：真实 PDF 只有一份，其他位置只是入口和分身。

### Collection Tree Moves and Safe Folder Merges 分类树移动与安全文件夹合并

When a Zotero collection is renamed or moved under another collection, ZotLink moves the corresponding folder tree first and then rebuilds linked-attachment paths for items below it. Files that exist in the folder but are not yet represented by Zotero items move with the folder as well, so the ordinary filesystem remains the complete source of truth.

当 Zotero 分类改名或移动到另一个分类下时，ZotLink 会先移动对应的完整文件夹树，再重建其下属条目的链接附件路径。即使文件夹里还有尚未纳入 Zotero 的文件，也会随整个目录一起移动，使普通文件系统继续保留完整内容。

If a same-named destination folder already exists, ZotLink moves and merges the source contents instead of copying them. The old folder is removed only after ZotLink confirms that it no longer represents an active collection, is empty, and is still the exact source folder recorded for that move. OneDrive read-only directory attributes are handled only at this final empty-folder cleanup step.

如果目标位置已经有同名文件夹，ZotLink 会移动并合并源目录内容，而不是复制文件。只有确认旧路径不再对应有效分类、目录确实为空，并且仍是本次移动记录的那个源文件夹时，才会删除旧目录。OneDrive 的只读目录属性也只在最后这个空目录清理步骤中处理。

Moves blocked by an open PDF are kept in a persistent retry queue. ZotLink retries after the file is closed and continues unfinished moves after Zotero restarts.

如果 PDF 正在打开而暂时无法移动，任务会进入持久重试队列；文件关闭后自动重试，重启 Zotero 后也会继续完成。

### Windows Folder Navigation Windows 文件夹右键定位

Installing and loading the ZotLink XPI automatically registers `定位到 Zotero 分类` (Locate in Zotero) in the Windows folder context menu. Choose it to select and focus the matching Zotero collection. Missing collections are created along the relative folder path; choosing the attachment root itself selects My Library. No literature is imported.

安装并加载 ZotLink XPI 后，自动注册 Windows 文件夹右键菜单 `定位到 Zotero 分类`。点击后选中对应分类并聚焦 Zotero；缺失分类会按文件夹的相对路径逐级创建。右键附件根目录本身时定位到“我的文库”，不会导入文献。

The command appears only for the attachment root configured in ZotLink preferences and its subfolders. Changing that setting updates the Windows visibility condition. This condition remains active when Zotero is closed, but using the command then displays a Windows prompt to open Zotero. Disabling or uninstalling ZotLink removes its menu and helper files.

菜单仅在 ZotLink 设置中的附件根目录及其子文件夹内显示，根目录外隐藏。修改根目录设置后同步更新显示范围；Zotero 关闭时仍能判断是否显示，但点击时会提示先启动 Zotero。禁用或卸载 ZotLink 会移除其菜单和助手文件。

### Structure-Only Rebuild 仅根据本地文件夹重建子分类结构（不导入PDF）

Choose the second command in a collection's ZotLink submenu: `仅根据本地文件夹重建子分类结构（不导入PDF）` (Rebuild Subcollections from Local Folders Only (No PDF Import)). It first creates missing folders for the selected collection and its descendants, then creates missing subcollections for disk subfolders. Existing same-named collections under the same parent are reused. It does not read PDF metadata, import literature, attach files, or move existing files.

分类右键 ZotLink 子菜单第二项 `仅根据本地文件夹重建子分类结构（不导入PDF）`，先为当前分类及全部子分类补建缺失文件夹，再为磁盘子文件夹补建缺失子分类；同一父分类下复用已有同名分类。它不读取 PDF 元数据、不导入文献、不添加附件，也不移动已有文件。

A ZotLink soft notification marks the start and closes when the task ends. A confirmation dialog reports the numbers of folders and subcollections created and the elapsed time. See manual entries E8 and E9 for these two features.

开始时显示 ZotLink 软提示，任务结束立即关闭；完成时用硬弹窗汇报新增文件夹、子分类数量和耗时。这两项功能详见手册 E8、E9。

### Standalone Windows PDF Tools 独立 Windows PDF 右键工具

Work on PDFs directly in File Explorer, without importing them into Zotero or keeping Zotero open. Together with folder-to-collection navigation, the registered context menus extend ZotLink's file-first workflow beyond Zotero.

直接在资源管理器中处理 PDF，无需先导入 Zotero，也无需保持 Zotero 开启。结合文件夹右键定位分类，自动注册的右键工具将 ZotLink 的文件优先工作流延伸到 Zotero 之外。

Installing and loading the XPI also registers a `ZotLink` submenu for PDF files: `Update DOI metadata only`, `Rename article/book`, and `Align PDF page labels`. These commands run independently of Zotero using bundled Python source. They require Python with its Windows launcher and the packages `pikepdf`, `pypdf`, and `requests`; no pydfdoi installation is needed. Disabling or uninstalling ZotLink removes its menu and helpers.

安装并加载 XPI 后，还会为 PDF 文件注册 `ZotLink` 子菜单：`Update DOI metadata only`、`Rename article/book`、`Align PDF page labels`。命令使用随插件打包的独立 Python 代码，可在 Zotero 关闭时运行；需要带 Windows 启动器的 Python 及 `pikepdf`、`pypdf`、`requests`，无需安装 pydfdoi。禁用或卸载插件时移除自有菜单和助手。

An existing PDF `/doi` is authoritative and is never replaced by rescanning pages. Only a missing `/doi` triggers text extraction from the first 20 pages, without OCR. `doiURL` is derived from the DOI and corrected when inconsistent. Rename retains the citation-based author/editor, year, title and subtitle rules. Align PDF page labels accepts conventional Crossref page ranges for journal articles, proceedings papers and chapters, skips whole books and article numbers, and labels an extra leading cover page `cover page`. See manual I1-I4.

已有 PDF `/doi` 始终优先，不会重新扫描页面来覆盖；只有缺少该字段时才读取前 20 页文字，不执行 OCR。`doiURL` 以 doi 为准补全或修正。改名沿用作者/编者、年份、主副标题的引用式规则；页码对齐支持有常规 Crossref 页码范围的期刊文章、会议论文和书籍章节，跳过整本书或文章号，额外前置封面的标签为小写 `cover page`。详见手册 I1-I4。

Install the Python dependencies with `py -3 -m pip install pikepdf pypdf requests`.

Python 依赖安装命令：`py -3 -m pip install pikepdf pypdf requests`。

The three PDF tools remain available when Zotero is closed. Nearby batch invocations are queued and summarized in an auto-closing, non-modal ZotLink notice. A filename already matching the citation target is left unchanged and reported as such. Align PDF page labels also writes or repairs DOI metadata. It locates the first content page using publisher-specific clues, the Crossref title and page range, and text from at most three leading and three trailing pages, without extracting middle-page text.

三个 PDF 工具在 Zotero 关闭后仍可使用。相近时间的批量调用会排队并合并为自动关闭的 ZotLink 软提示，无需逐个点击确定。文件名已符合引用目标时直接跳过改名并明确说明。页码对齐也会补写或修正 DOI 元数据；正文第一页通过出版社特征、Crossref 标题及页码范围，以及最多前 3 页和后 3 页的文字定位，不提取中间页面文字。

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

### Open Collection Folder 打开分类目录

Right-click a collection and choose `Open Collection Folder`, placed beside Zotero's native `Rename` command. ZotLink opens the matching folder under the configured attachment root; if the folder does not yet exist, ZotLink creates the complete directory path first. This command is intentionally placed in the main collection context menu rather than inside the ZotLink submenu.

右键单击分类并选择位于 Zotero 原生“重命名”旁边的 `打开分类目录`，即可打开附件顶层路径下与该分类层级对应的文件夹。如果目录尚不存在，ZotLink 会先创建完整目录路径。这个命令直接位于分类主右键菜单中，不放在 ZotLink 子菜单内。

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

### Planned Crossref Metadata Repair 计划中的 Crossref 元数据修复

ZotLink plans to absorb the part of Linter-style workflows that matter most for linked-PDF management: using an item's DOI to query Crossref and refresh publication metadata such as date, volume, issue, and pages. The pain point is that DOI-based imports and publisher metadata are often incomplete or inconsistent; ZotLink will treat Crossref lookup as a focused repair step rather than a general-purpose linting system.

ZotLink 后续计划吸收 Linter 类工作流中最适合链接附件管理的一部分：通过条目的 DOI 查询 Crossref，并更新日期、Volume、Issue 和页码等出版信息。痛点在于 DOI 导入和出版社元数据常常不完整或不一致；ZotLink 会把 Crossref 查询作为聚焦的修复步骤，而不是做成完整的通用 Linter 系统。

### Correct a PDF DOI Manually 手动修正 PDF DOI

If automatic DOI detection is incorrect, edit the PDF's custom metadata in a PDF editor. In Adobe Acrobat, open File > Properties (`Ctrl+D`) > Custom. Enter `doi` as the Name and the correct bare DOI as the Value, for example `10.1000/example` (without `https://doi.org/`). Click Add or Change, then OK, and save the PDF file. Run the Windows PDF context command `ZotLink > Update DOI metadata only` again: it uses the corrected `doi` and updates the corresponding `doiURL` rather than searching the page text again.

如果 DOI 自动识别错误，可用 PDF 编辑器手动修改 PDF 的自定义元数据。例如在 Adobe Acrobat 中，点击“文件 → 属性（Ctrl+D）→ 自定义”，在“名称”中填写 `doi`，在“值”中填写正确的 DOI，例如 `10.1000/example`，不要带 `https://doi.org/`。点击“添加”或“更改”，再点击“确定”，并保存 PDF 文件。然后重新运行 Windows PDF 右键命令 `ZotLink > Update DOI metadata only`；它会使用修正后的 `doi` 更新对应的 `doiURL`，而不重新从页面文字中查找。

After installing ZotLink, enabling the corresponding PDF processing options also applies the selected operations when a PDF is first dragged into Zotero and enters ZotLink's attachment processing workflow. Automatic metadata writing inside Zotero uses the parent item's DOI; correct that DOI too if necessary. This automatic workflow does not open the PDF editor or perform the manual correction for you.

安装 ZotLink 后，若设置中已勾选相应 PDF 处理选项，首次将 PDF 拖入 Zotero 并进入 ZotLink 附件处理流程时，也会自动执行已启用的操作。Zotero 内的自动元数据写入以父文献条目的 DOI 为依据，必要时也应修正文献条目的 DOI；自动流程不会代替用户打开 PDF 编辑器或手动纠错。

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

## Usage Recommendations and Notes 使用建议与注意事项

Keep an Internet connection available for operations that query Crossref, including citation-based renaming and Windows PDF page-label alignment. Inside Zotero, page alignment uses the parent item's existing page range instead; writing a locally available DOI also does not inherently need the network. The Windows helpers report connection failures, timeouts and service errors in the ZotLink completion notice and stop failed Crossref requests before modifying the PDF. Their connection timeout is 5 seconds and read timeout is 20 seconds, without automatic retries; these are not a total task-time limit.

执行查询 Crossref 的操作时应保持联网，包括引用式重命名和 Windows 右键的页面标签对齐。Zotero 内页码对齐使用父条目已有页码范围；写入本地已有 DOI 本身也无需联网。Windows 助手遇到断网、超时或服务异常，会在 ZotLink 完成提示中说明，请求失败时停止，不修改 PDF。连接超时为 5 秒，读取超时为 20 秒，不自动重试；这并非整个任务的总时限。

For first-time use, rebuild subcollections from local folders first, then import PDFs one folder at a time using `仅导入当前文件夹 PDF`. Avoid importing all PDFs in one large batch, which may cause long waits and an unresponsive interface.

首次使用建议先根据本地文件夹重建子分类结构，再使用 `仅导入当前文件夹 PDF` 逐个文件夹导入。尽量避免一次性导入所有 PDF，以减少长时间等待与界面卡顿。

Collection-folder imports are metadata-only: PDFs without DOI or ISBN metadata are skipped, not sent through whole-document recognition. The separate Windows PDF commands may search up to the first 20 pages for a missing DOI; use that fallback selectively rather than starting a large batch. There is currently no separate preference switch for page-text DOI discovery.

分类文件夹导入只读元数据：没有 DOI 或 ISBN 元数据的 PDF 会跳过，不进行全文识别。独立的 Windows PDF 右键命令在缺少 DOI 字段时可能搜索前 20 页文字，建议仅对少量文件使用这种补救方式，不建议大批量启用。目前没有单独控制页面文字 DOI 查找的设置开关。

ZotLink is currently Windows-oriented because Windows file ID, `.lnk` shortcuts, and NTFS move semantics are central to its workflow.

ZotLink 当前主要面向 Windows，因为 Windows 机内码、`.lnk` 快捷方式和 NTFS 移动语义都是核心工作流的一部分。

ZotLink is intended for linked attachments. If you prefer Zotero storage file attachments and want PDFs to stay inside Zotero storage, ZotLink may not fit your workflow.

ZotLink 面向链接附件工作流。若你偏好 Zotero storage 文件附件，并希望 PDF 始终留在 Zotero storage 内，本插件可能不适合你的工作流。

PDF metadata writing modifies PDF source files. Back up your attachment folder before running whole-library operations for the first time.

PDF metadata 写回会修改 PDF 源文件。首次执行全库操作前，建议备份附件目录。

Prefer complete publisher-provided PDFs that retain their original layout. Avoid files assembled from multiple sources, incomplete extracts, or heavily rearranged editions, as missing metadata or altered page structure may cause information extraction to fail or produce inaccurate results.

建议优先导入出版社提供、保留原始排版的完整 PDF。尽量避免使用多来源拼接、内容缺失或大幅重排的版本，以减少因元数据缺失或页面结构变化导致的信息读取失败或识别偏差。

## Version Log 版本记录

See [VERSION_LOG.md](VERSION_LOG.md).

详见 [VERSION_LOG.md](VERSION_LOG.md)。

## User Manual 功能手册

For a complete numbered reference to every ZotLink feature, trigger, behavior, and limitation, see [USER_MANUAL.md](USER_MANUAL.md). Feature IDs such as `A2`, `C4`, and `F3` are kept stable so they can be used in issue reports and future discussions.

有关 ZotLink 各项功能、触发条件、实际行为与限制的完整编号说明，请参阅 [USER_MANUAL.md](USER_MANUAL.md)。`A2`、`C4`、`F3` 等功能编号会保持稳定，便于问题反馈和后续讨论时直接定位。
