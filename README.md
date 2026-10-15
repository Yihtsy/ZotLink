# ZotLink

[![release](https://img.shields.io/badge/release-v0.8.0-blue)](https://github.com/Yihtsy/ZotLink/releases/tag/v0.8.0)
[![license](https://img.shields.io/badge/license-MIT-orange)](LICENSE)
[![Zotero](https://img.shields.io/badge/Zotero-10-red)](https://www.zotero.org/)

ZotLink is a Windows attachment manager for Zotero 10 users who prefer linked attachments and keep their PDFs in ordinary folders.

ZotLink 是一个面向 Zotero 10 的 Windows 链接附件管理插件，服务于喜欢将 PDF 保存在普通文件夹中的用户。

In line with Obsidian's file-first philosophy, ZotLink follows one guiding principle: your literature files should remain understandable, portable, and independently usable, even in a future where Zotero and/or ZotLink are no longer part of your workflow.

与 Obsidian 的文件优先理念一致，ZotLink 坚持一个总的指导原则：即使未来 Zotero 和/或 ZotLink 不再是工作流程的一部分，文献文件也应当始终清晰、可迁移、可独立使用。

## Highlights 核心特性

1. **File Identity and Link Repair 机内码与链接修复**

   Track Windows file ID and attachment path together to recover links after external renaming or moving.

   同时记录 Windows 机内码与附件路径，修复外部改名或移动造成的附件脱钩。

2. **Collection-Aware File Moves 文件随分类移动**

   Move files and folder trees with collection changes, including renames, merges and retries for temporarily locked files.

   文件及完整目录树随分类变化而移动，支持分类改名、目录合并及文件占用后的自动重试。

3. **Multi-Collection Shortcut Mirrors 多重分类与快捷方式分身**

   Keep one real PDF with shortcut mirrors in other collections, and swap the real file's location when needed.

   一份真实 PDF 对应多个分类快捷方式分身，并可按需切换本体所在位置。

4. **Folder-Based Library Rebuilding 从文件夹重建文献库**

   Rebuild collection structure, import PDFs by DOI/ISBN metadata, and reconnect an existing folder-based library.

   根据文件夹重建分类结构，利用 DOI/ISBN 元数据导入 PDF，并接续已有文件夹文献库。

5. **PDF Processing and Windows Tools PDF 处理与 Windows 工具**

   Update DOI metadata, rename PDFs and align page labels; registered Windows PDF commands also work with Zotero closed.

   更新 DOI 元数据、重命名和对齐 PDF 页面标签；已注册的 Windows PDF 右键命令在 Zotero 关闭后仍可使用。

6. **Quick Literature Links 快速复制文献链接**

   Copy DOI/URL links or combined DOI and Zotero PDF Markdown links for Obsidian and other note-taking tools.

   为 Obsidian 等笔记工具快速复制 DOI/URL，或同时包含 DOI 与 Zotero PDF 引用的 Markdown 链接。

## Getting Started and Recommendations 使用方式与建议

Install the [latest XPI](https://github.com/Yihtsy/ZotLink/releases/latest), restart Zotero, and enter your PDF root folder under **附件顶层路径** in ZotLink preferences. Settings are saved automatically.

安装[最新版 XPI](https://github.com/Yihtsy/ZotLink/releases/latest) 并重启 Zotero，在 ZotLink 设置的 **附件顶层路径** 中填写 PDF 根目录。设置自动保存。

**Starting from scratch:** try a few items first. If you have uncataloged PDFs in local folders, use **仅根据本地文件夹重建子分类结构（不导入PDF）**, then **仅导入当前文件夹 PDF** folder by folder rather than importing everything at once.

**从零开始：**先用少量条目试用。如果本地已有尚未编目的 PDF 文件夹，先使用 **仅根据本地文件夹重建子分类结构（不导入PDF）**，再通过 **仅导入当前文件夹 PDF** 逐个导入，不建议首次一口气导入全部文件。

**Continuing an existing linked library:** if you previously used ZotLink or Attanger and already keep your literature in a dedicated folder tree, set **附件顶层路径** to that existing root, then click **从顶层文件夹重建链接库**. Existing items and attachments are matched and reused where possible.

**接续已有链接附件库：**如果此前使用 ZotLink 或 Attanger，已将文献集中在固定文件夹中，先把 **附件顶层路径** 设为该现有根目录，再点击 **从顶层文件夹重建链接库**，按匹配结果复用已有条目和附件。

Back up your Zotero data and PDFs before bulk operations. Prefer complete, original publisher PDFs. Keep a network connection for Crossref queries. If you prefer attachments to remain inside Zotero storage, ZotLink may not suit your workflow. See the [manual](USER_MANUAL.md) for dependencies, settings, limitations and DOI correction steps.

批量操作前请备份 Zotero 数据和 PDF，优先使用出版社提供、保留原始排版的完整 PDF；查询 Crossref 时需联网。若偏好将附件始终保存在 Zotero storage 内，本插件可能不适合你的工作流。依赖安装、设置、限制及 DOI 纠错步骤详见[功能手册](USER_MANUAL.md)。

## Features 功能介绍

### 1. File Identity and Link Repair 机内码与链接修复

A path alone breaks when a file is renamed. ZotLink also records its Windows file ID, allowing it to check and repair links when opening an attachment or during library maintenance, including changes made while Zotero was closed. Files found outside the configured root are reported rather than silently moved back.

仅记录路径无法应对外部改名。ZotLink 同时记录 Windows 机内码，可在打开附件或全库维护时检查、修复链接，也能处理 Zotero 关闭期间发生的变化；发现文件已移出设定根目录时只提示，不擅自搬回。

Details: [manual C1-C7](USER_MANUAL.md#c-机内码索引与链接修复).

详细说明：[手册 C1-C7](USER_MANUAL.md#c-机内码索引与链接修复)。

### 2. Collection-Aware File Moves 文件随分类移动

ZotLink moves rather than copies files within the same volume to preserve file identity. Collection moves and renames carry the mapped folder tree, including files not cataloged in Zotero. Folder merges remove the source only when it is confirmed empty; blocked moves are queued for retry. PDFs copied into Zotero storage can also be moved into the linked-file workflow.

ZotLink 在同一卷内采用移动而非复制来保留文件身份。分类移动或改名时，对应完整目录树随之调整，包括尚未纳入 Zotero 的文件；目录合并仅在确认源目录为空后清理，遇到文件占用则排队重试。复制进入 Zotero storage 的 PDF 也可转入链接附件流程。

Details: [manual A1-A5](USER_MANUAL.md#a-附件放置与移动).

详细说明：[手册 A1-A5](USER_MANUAL.md#a-附件放置与移动)。

### 3. Multi-Collection Shortcut Mirrors 多重分类与快捷方式分身

One attachment has one real path. For items in multiple collections, ZotLink keeps one real PDF and creates `.lnk` entrances elsewhere. Normal dragging adds a mirror; Shift-dragging relocates the real file and refreshes the mirrors, like Yuan'ge or Kongkong'er's body-and-double swap in Honor of Kings.

一个附件只有一个真实路径。文献属于多个分类时，ZotLink 保留一份真实 PDF，在其他目录创建 `.lnk` 入口。普通拖拽添加分身，Shift+拖拽移动本体并刷新分身，类似《王者荣耀》中元歌或空空儿的本体与分身换位。

Hard links were considered but not selected: they obscure the primary path and can make file-manager, sync and deletion behavior less intuitive. Shortcuts make the model explicit: one file, multiple entrances.

我们考虑过硬链接，但其主路径不够直观，文件管理、同步和删除行为也容易混淆，因此选择更明确的快捷方式模型：一份真实文件，多个入口。

Details: [manual B1-B6](USER_MANUAL.md#b-多重分类与快捷方式分身).

详细说明：[手册 B1-B6](USER_MANUAL.md#b-多重分类与快捷方式分身)。

### 4. Folder-Based Library Rebuilding 从文件夹重建文献库

Rebuild structure without importing PDFs, import one folder or its descendants, or reconnect the entire configured root. ZotLink reconciles folders and collections first, then uses file identity and DOI/ISBN metadata to reuse existing items or add missing ones. The same folder tree can support migration between computers, including cloud-synced folders such as OneDrive.

可以只重建分类结构而不导入 PDF，也可导入单个文件夹、包含子文件夹，或接续整个根目录。ZotLink 先对齐文件夹与分类结构，再通过机内码及 DOI/ISBN 元数据复用已有条目或补建缺失条目。同一目录体系可用于跨电脑迁移，也可放在 OneDrive 等同步目录中。

The Windows folder context command **定位到 Zotero 分类** navigates from a folder to its collection while Zotero is running.

Windows 文件夹右键的 **定位到 Zotero 分类** 可在 Zotero 运行时从文件夹跳转到对应分类。

Details: [manual E1-E9](USER_MANUAL.md#e-文件夹导入与文库重建).

详细说明：[手册 E1-E9](USER_MANUAL.md#e-文件夹导入与文库重建)。

### 5. PDF Processing and Windows Tools PDF 处理与 Windows 工具

Write or correct DOI/DOI URL metadata, align page labels, and adjust PDF viewer preferences. For renaming, use Zotero's customizable field template or opt into ZotLink's fixed `Authors Year Main title  Subtitle` form. Single-file automatic operations and bulk update options are independently configured.

支持写入或纠正 DOI/DOI URL 元数据、对齐页面标签及调整 PDF 查看设置。改名可选择 Zotero 自带的字段组合模板，或勾选 ZotLink 固定的 `作者引用形式 年份 主标题  副标题` 规则。单文件自动处理与全库更新选项独立设置。

Installing ZotLink also registers PDF context commands in Windows: **Update DOI metadata only**, **Rename article/book**, and **Align PDF page labels**. These run without Zotero, using Python and the dependencies listed in the manual. Article history extraction and its fields are handled separately by ZotFields.

安装后还会注册 Windows PDF 右键命令：**Update DOI metadata only**、**Rename article/book** 和 **Align PDF page labels**。这些命令无需 Zotero 运行，但需要 Python 及手册列出的依赖。文章投稿历史提取及其字段由 ZotFields 独立负责。

Details: [manual D](USER_MANUAL.md#d-pdf-元数据与文件处理), [G](USER_MANUAL.md#g-设置快捷键与全库更新) and [I](USER_MANUAL.md#i-windows-pdf-右键工具).

详细说明：[手册 D](USER_MANUAL.md#d-pdf-元数据与文件处理)、[G](USER_MANUAL.md#g-设置快捷键与全库更新) 和 [I](USER_MANUAL.md#i-windows-pdf-右键工具)。

### 6. Quick Literature Links 快速复制文献链接

A context command or configurable shortcut copies the DOI URL, falling back to the item URL only when no valid DOI is available. A second command copies Markdown containing both the literature link and the Zotero PDF link, for fast insertion into Obsidian and similar note-taking applications.

通过右键或自定义快捷键复制 DOI URL，仅在没有有效 DOI 时回退使用条目 URL；另一个命令可同时复制文献链接和 Zotero PDF 链接组成的 Markdown，便于在 Obsidian 等笔记软件中拖选文字后插入链接。

Details: [manual F1-F5](USER_MANUAL.md#f-快速复制文献链接).

详细说明：[手册 F1-F5](USER_MANUAL.md#f-快速复制文献链接)。

## Why ZotLink 为什么做 ZotLink

Linked files should not become unusable just because they were renamed in File Explorer or moved to another computer. ZotLink builds on workflows familiar from [ZotMoov](https://github.com/wileyyugioh/zotmoov), [Attanger](https://github.com/MuiseDestiny/zotero-attanger) and the classic [ZotFile](https://github.com/jlegewie/zotfile), with a focus on file identity repair, collection-folder synchronization and swappable shortcut mirrors.

链接文件不应因资源管理器中的改名或电脑迁移而失去可用性。ZotLink 延续 [ZotMoov](https://github.com/wileyyugioh/zotmoov)、[Attanger](https://github.com/MuiseDestiny/zotero-attanger) 及经典前辈 [ZotFile](https://github.com/jlegewie/zotfile) 所代表的附件管理工作流，重点解决文件身份修复、分类目录同步和快捷方式分身换位的问题。

## Documentation 文档

See the [numbered user manual](USER_MANUAL.md) for complete instructions and the [version log](VERSION_LOG.md) for changes.

完整操作说明见[编号功能手册](USER_MANUAL.md)，更新内容见[版本记录](VERSION_LOG.md)。
