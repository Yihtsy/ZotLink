# ZotLink 0.8.0

## Windows Context Tools Windows 右键工具

- Process PDFs directly in File Explorer: Update DOI metadata only, Rename article/book, and Align PDF page labels. Once registered, these commands also run with Zotero closed. Python and the documented dependencies are required.
- 在资源管理器中直接更新 PDF DOI 元数据、按引用信息重命名和对齐页面标签。注册后即使 Zotero 关闭也可运行；需要 Python 和文档说明的依赖。
- Locate folders in Zotero from the Windows folder menu; missing collections are created within the configured root. Folder navigation requires Zotero to be running.
- Windows 文件夹右键可定位 Zotero 分类，并在配置的根目录内补建缺失分类；定位功能需要 Zotero 正在运行。

## PDF and Settings PDF 与设置

- Bounded publisher-aware page-label inference, authoritative DOI metadata, automatic DOI URL correction, unchanged-filename skipping, non-modal batch completion and actionable Crossref network errors.
- 使用有限首尾页及出版社特征定位正文；DOI 元数据优先、DOI URL 纠正、同名跳过改名、批量软提示及 Crossref 网络异常中文提示。
- Single-file and bulk options are independent. Bulk defaults enable only DOI metadata. Rebuild Library and Check/Repair Links now share the first row, with repair on the right.
- 单文件与全库选项独立，全库默认仅勾选 DOI 元数据。首行左侧重建链接库、右侧检查并修复链接。
- Article history extraction, date fields and settings move to ZotFields (formerly Zotero Literature Fields); existing Extra dates remain unchanged.
- 投稿历史提取、日期字段及设置迁至 ZotFields（原 Zotero Literature Fields），已有 Extra 日期不变。

## Library Workflow and Documentation 文库流程与文档

- Structure-only subcollection rebuilding, collection rename/folder synchronization and shortcut filename fixes are included in this release.
- 本次一并发布仅重建子分类结构、分类改名同步目录和快捷方式文件名修复。
- Updated bilingual README, numbered manual and usage recommendations: rebuild structure first, import folder by folder, prefer complete publisher PDFs, back up originals and correct mistaken DOI metadata manually when necessary.
- 更新中英 README、编号手册与使用建议：先重建结构、逐文件夹导入、优先出版社完整 PDF、备份源文件，并在必要时手动纠正 DOI 元数据。

Read the README and USER_MANUAL before whole-library processing. This release targets Zotero 10 on Windows.

整库处理前请阅读 README 和 USER_MANUAL。本版面向 Windows 上的 Zotero 10。
