# ZotLink

[![release](https://img.shields.io/badge/release-v0.3.20-blue)](https://github.com/Yihtsy/ZotLink/releases/tag/v0.3.20)
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

- Represent multi-collection items as one real PDF plus `.lnk` shortcut mirrors in the other collection folders.
- 一个条目属于多个分类时，保留一份真实 PDF，并在其他分类文件夹中创建 `.lnk` 快捷方式分身。

- Swap the real PDF location when you Shift-drag an item to another collection, then refresh shortcut mirrors.
- Shift+拖拽条目到其他分类时，可把真实 PDF 换位移动到新分类文件夹，并刷新其他快捷方式分身。

- Import PDFs from a collection folder, or rebuild a linked Zotero library from the whole configured folder root by reading PDF DOI metadata.
- 支持从分类文件夹导入 PDF，也支持从配置的顶层文件夹递归读取 PDF DOI 元数据，快速重建链接附件库。

- Write DOI metadata back into PDFs and correct `/doiURL` when it does not match `/doi`.
- 支持把 DOI 元数据写回 PDF，并在 `/doiURL` 与 `/doi` 不一致时自动纠正。

- Align PDF page labels from Zotero item page ranges such as `10-18` or `S10-S18`.
- 支持根据 Zotero 条目的常规页码范围（如 `10-18`、`S10-S18`）对齐 PDF 页码标签。

- Extract journal article history dates from the primary PDF and write `Received:`, `Revised:`, `Accepted:`, and `Online:` lines into Zotero Extra.
- 支持从期刊文章主 PDF 中提取文章历史时间线，并写入 Zotero Extra 中的 `Received:`、`Revised:`、`Accepted:`、`Online:` 字段行。

## Basic Usage 使用方式

Install `zotlink-0.3.20.xpi` in Zotero, restart Zotero, and set the attachment root folder in ZotLink preferences, for example `D:\OneDrive\Zotero`.

在 Zotero 插件管理器中安装 `zotlink-0.3.20.xpi`，重启 Zotero，然后在 ZotLink 设置中填写附件顶层路径，例如 `D:\OneDrive\Zotero`。

Select Zotero items or attachments and use `ZotLink -> Move Attachments to Collection Folder` from the item context menu.

选中文献条目或附件后，可使用右键菜单 `ZotLink -> 移动附件到分类文件夹`。

Drag an item normally into another collection to keep the real PDF where it is and create a shortcut mirror in the new collection folder. Shift-drag an item to move the real PDF to the new collection folder and turn the old folder entry into a shortcut mirror.

普通拖拽条目到另一个分类时，真实 PDF 保持在原位置，并在新增分类文件夹中创建快捷方式分身。Shift+拖拽时，真实 PDF 会移动到新分类文件夹，原文件夹位置会变成快捷方式分身。

ZotLink preferences include instant checkboxes for automatic PDF processing during file operations. DOI/DOI URL metadata writing, page-label alignment, opening PDFs at the first page, and making PDF viewers show the filename are enabled by default; article history extraction is disabled by default.

ZotLink 设置中提供文件操作自动处理勾选项，勾选后即时生效。DOI/DOI URL 元数据写入、页码标签对齐、打开 PDF 时定位首页、让 PDF 查看器显示文件名默认开启；文章投稿历史识别默认关闭。

## Features 功能介绍

### Multi-Collection Shortcut Mirrors 多重分类与快捷方式分身

Zotero binds one attachment item to one real file path, but one literature item may belong to multiple collections. ZotLink solves this by keeping a single real PDF and creating `.lnk` shortcut mirrors for the other collection folders.

Zotero 的一个附件条目只能绑定一个真实文件路径，但一个文献条目常常同时属于多个分类。ZotLink 的做法是保留一份真实 PDF，并为其他分类文件夹创建 `.lnk` 快捷方式分身。

ZotLink considered hard links, but did not choose them as the default strategy. Hard links can make the primary path unclear, are not always friendly in ordinary file managers or sync tools, and can make deletion semantics confusing. `.lnk` shortcuts make the model explicit: one real PDF, multiple visible entrances.

ZotLink 曾认真考虑硬链接方案，但最终没有把它作为默认方式。硬链接会让主路径不直观，在普通文件管理器和同步盘中也未必符合用户预期，删除语义也容易混淆。`.lnk` 快捷方式更明确：真实 PDF 只有一份，其他位置只是入口和分身。

### Root Folder Library Rebuild 顶层文件夹重建链接库

The preference button `Rebuild Linked Library from Root Folder` first reconciles collection and folder structure in both directions: existing collections create missing folders, and existing folders create missing collections. Within the same parent collection, ZotLink reuses an existing child collection with the same name instead of creating duplicates. It then recursively scans PDFs, reads DOI metadata, skips DOIs already present in the Zotero library, and adds the PDFs as linked attachments.

设置页按钮 `从顶层文件夹重建链接库` 会先双向对齐分类与文件夹结构：已有分类但没有对应文件夹时创建文件夹；已有文件夹但没有对应分类时创建分类。同一个父分类下如果已有同名子分类，ZotLink 会复用它，不会重复创建。随后再递归扫描 PDF、读取 DOI metadata、跳过 Zotero 库中已有 DOI，并将 PDF 作为链接附件加入 Zotero。

This is designed for users who manage PDFs directly in a cloud-synced folder such as OneDrive. After moving to another computer, the same folder structure can be used to quickly rebuild Zotero linked attachments.

这个功能面向喜欢直接管理文件夹和文件的用户，尤其适合把 PDF 放在 OneDrive 等第三方同步盘中特定目录的人。跨机器迁移后，只要文件夹结构保持一致，就可以快速重建 Zotero 的链接附件关系。

### Collection Folder PDF Import 从分类文件夹导入 PDF

From the left collection context menu, ZotLink can import PDFs from the selected collection folder only, or recursively import subfolders and create matching child collections.

在左侧分类的右键菜单中，ZotLink 可以只导入当前分类对应文件夹中的 PDF，也可以递归导入子文件夹并创建匹配的子分类。

ZotLink reads DOI values from PDF Info/XMP metadata fields such as `doi`, `DOI`, `prism:doi`, and `dc:identifier`, then uses Zotero's search translators to create full Zotero items.

ZotLink 会读取 PDF Info/XMP metadata 中的 `doi`、`DOI`、`prism:doi`、`dc:identifier` 等 DOI 字段，然后调用 Zotero 搜索翻译器创建完整条目。

### PDF DOI Metadata and Page Labels PDF DOI 元数据与页码标签

ZotLink can write `/doi` and `/doiURL` into PDF metadata. If `/doi` already exists, it is treated as authoritative; if `/doiURL` is missing or inconsistent, ZotLink rewrites `/doiURL` from `/doi`.

ZotLink 可以把 `/doi` 与 `/doiURL` 写入 PDF metadata。如果 PDF 已经存在 `/doi`，则以 `/doi` 为准；如果 `/doiURL` 缺失或不一致，ZotLink 会按 `/doi` 重写 `/doiURL`。

ZotLink can also write PDF page labels from the parent Zotero item's `pages` field, but only for conventional ranges such as `10-18` or `S10-S18`. Article numbers and page values without a hyphen are skipped.

ZotLink 也可以根据父条目的 `pages` 字段写入 PDF 页码标签，但只处理 `10-18`、`S10-S18` 这类常规范围。文章号或没有连字符的页码值会被跳过。

### Article History Fields 文章历史时间线字段

For English journal article items, ZotLink can read the primary PDF and extract article history dates such as received, revised, accepted, and online publication dates. The results are written into Zotero Extra as `Received: YYYY-MM-DD`, `Revised: YYYY-MM-DD`, `Accepted: YYYY-MM-DD`, and `Online: YYYY-MM-DD`, and ZotLink also exposes them as dedicated item-info rows when Zotero supports custom info rows.

对于英文期刊文章条目，ZotLink 可以读取主 PDF，提取收稿、修订、录用和在线发表等文章历史时间线，并以 `Received: YYYY-MM-DD`、`Revised: YYYY-MM-DD`、`Accepted: YYYY-MM-DD`、`Online: YYYY-MM-DD` 的形式写入 Zotero Extra；在 Zotero 支持自定义信息栏字段时，ZotLink 也会把它们显示为独立信息栏行。

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
