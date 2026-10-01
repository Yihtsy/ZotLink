# ZotLink 功能细化

## 目标

ZotLink 负责 Zotero 链接附件的移动、机内码记录、collection 镜像和链接修复，不处理文献类型或自定义字段。

## 附件移动

- 从当前选中的普通条目或附件条目中收集文件附件。
- 按当前 Zotero collection 层级生成目标目录。
- 使用移动操作移动附件文件。
- 移动成功后更新 Zotero 链接附件路径，并把附件标题同步为新文件名。
- 如果附件已经在目标目录，会跳过移动，但仍可刷新机内码索引。

## 机内码索引

索引存储在 Zotero preferences 中：

```text
extensions.zotlink.attachmentFileIndex
```

索引以附件条目的 `attachment.key` 为主键，每条记录包含：

- `itemID`
- `key`
- `fileID`
- `path`
- `primaryPath`
- `shortcutPaths`
- `hardlinkPaths`
- `fileName`
- `updatedAt`

`primaryPath` 是 Zotero 附件条目实际绑定的真实文件路径。旧版 `path` 字段继续保留，并等同于当前主路径。

`shortcutPaths` 是 `0.2.0` 起默认使用的 collection 镜像路径列表。`hardlinkPaths` 是 `0.1.x` 硬链接模式的遗留字段，保留用于迁移和清理。

## 多 collection 快捷方式镜像

从 `0.2.0` 起，ZotLink 默认使用 `.lnk` 快捷方式处理一个条目属于多个 collections 的情况：

- 一个 Zotero 附件条目仍然只绑定一个真实主路径。
- 如果父文献属于多个 collections，其他 collection 目录下创建 `.lnk` 快捷方式。
- 快捷方式文件名使用真实文件名加 `.lnk`，例如 `paper.pdf.lnk`。
- 如果父文献移出某个 collection，ZotLink 会删除对应 `.lnk`。
- 如果 Shift+拖拽导致主路径所在 collection 被移除，ZotLink 会把真实文件移动到新增 collection 对应目录，并更新 Zotero 附件路径。
- 文件名同步以 Zotero 当前主路径文件名为准；同步流程会重新生成匹配当前主路径的 `.lnk`。

## 硬链接 legacy 代码

`0.1.15` 是最后一个默认使用硬链接的版本。硬链接实现保留在源码中，主要函数包括：

- `ensureHardlinkPath`
- `createHardlinkForAttachment`
- `createHardlinkWithPython`

这些函数从 `0.2.0` 起不再被默认同步路径调用，仅作为 legacy/reference 保留。

## 自动记录

- Zotero 通知条目 `add` 或 `modify` 时，延迟约 5 秒检查相关文件附件。
- 如果检查到文件是以复制形式进入 Zotero 的 storage 附件，会自动按文献集合路径移出 storage，改为链接附件，并删除原 storage 子目录。
- 如果附件索引不存在，或索引路径与当前路径不同，会静默刷新机内码。
- 如果通知对象是普通文献条目，会检查其下的文件附件。
- 如果通知对象是文件附件，会直接检查该附件。

## Collection 变化

- 普通拖拽条目到另一个 collection：ZotLink 保留真实主路径，并为新增 collection 创建 `.lnk`。
- Shift+拖拽条目到另一个 collection：ZotLink 将真实文件移动到新增 collection 对应目录，并刷新其他 `.lnk`。
- 拖拽结束后使用短状态提示或 debug 日志记录变化，不再弹出确认对话框。

## 从 Collection 文件夹导入 PDF

- 在左侧 collection 右键菜单中增加 `ZotLink -> 仅导入当前文件夹 PDF` 和 `ZotLink -> 导入当前文件夹及子文件夹 PDF`。
- 根据 collection 层级定位附件顶层路径下的对应文件夹。
- `仅导入当前文件夹 PDF` 只扫描当前文件夹第一层的 PDF，不进入子文件夹。
- `导入当前文件夹及子文件夹 PDF` 会递归扫描子文件夹，并把子文件夹映射到 Zotero 子 collection。
- 递归导入时，如果同名子 collection 已存在，就导入到该子 collection；如果不存在，就自动创建后再导入。
- 优先按字段解析 PDF Info/XMP metadata 中可能存在的 DOI 字段，并兼容 UTF-8、UTF-16、PDF 十六进制字符串和 PDF literal string 八进制转义等常见 metadata 编码。
- 如果 metadata/XMP 中未找到 DOI，再用轻量字节搜索兜底。
- 如果目标 collection 中已有相同 DOI，跳过该 PDF。
- 如果 DOI 不存在或无法识别，跳过该 PDF。
- 为成功识别 DOI 的 PDF 调用 Zotero 搜索翻译器获取完整元数据，效果接近“通过标识符添加条目”。
- 如果 DOI 查询失败，退回到只包含 DOI 和文件名标题的基础条目。
- 将 PDF 作为链接附件添加到该条目。
- 创建附件后立即记录机内码。

## PDF DOI 元数据写回与页码对齐

- 新增/导入 PDF 文件附件后，ZotLink 会读取父条目的 DOI。
- 如果父条目存在 DOI，且 PDF 源文件中缺少 `/doi` 或 `/doiURL`，则通过 Python `pikepdf` 补写缺失字段。
- 如果 PDF 已经同时存在且匹配的 `/doi` 和 `/doiURL`，则跳过，不覆盖已有 metadata。
- 如果 PDF 已经同时存在 `/doi` 和 `/doiURL`，但 `/doiURL` 与 `/doi` 不一致，则以 `/doi` 为准覆盖 `/doiURL`。
- 设置页提供 `写入全库 PDF DOI 元数据并对齐页码` 按钮，可对当前个人库中的 PDF 附件统一执行一次。
- 条目右键菜单新增 `ZotLink -> 写入 PDF DOI 元数据`，右键普通条目时只处理主 PDF，右键具体 PDF 附件时只处理该附件。
- 如果 Python 环境缺少 `pikepdf`，会跳过并在结果中说明。
- 新增/导入/同步主 PDF 后，ZotLink 会读取父条目 `pages` 字段并尝试对齐 PDF `/PageLabels`。
- 页码对齐只接受常规范围，例如 `10-18` 或 `S10-S18`；文章号、没有连字符的页码值和 PDF 页数少于条目页码范围的情况会跳过。
- 条目右键菜单新增 `ZotLink -> 对齐 PDF 页码`，可单独执行页码对齐。

## 主 PDF 重命名

- `0.3.0` 新增可配置的主 PDF 重命名功能，默认关闭。
- 设置项 `autoRenameAttachmentsEnabled` 控制新增或同步流程中是否自动重命名主 PDF。
- 设置项 `attachmentRenamePattern` 控制命名规则，默认值为 `{author} {year} {title}`。
- 支持占位符 `{author}`、`{authors}`、`{year}`、`{title}`、`{doi}`。
- 自动触发时只处理父条目的主 PDF，不会批量重命名同一条目下的其他 PDF 附件。
- 条目右键菜单新增 `ZotLink -> 按规则重命名主 PDF`。
- 右键普通条目时只处理该条目的主 PDF；右键具体 PDF 附件时只处理该附件。
- 重命名使用移动语义，并在成功后更新 Zotero 链接附件路径、刷新机内码索引和 collection 快捷方式镜像。

## 链接修复

- 打开或定位附件前，如果当前路径不存在，按已记录机内码搜索文件。
- 搜索优先从原记录目录、快捷方式目录开始，再回退到设置中的附件顶层路径。
- 找到同机内码真实文件后，更新 Zotero 链接附件路径和附件标题。

## 设置

- `attachmentMoveRoot`：附件移动和修复扫描的顶层路径。
- `attachmentMoveShortcut`：移动附件快捷键。
- `lastMoveReport`：最近一次移动或修复结果。
- `lastIndexReport`：最近一次全库初始化结果。
- `attachmentFileIndex`：附件机内码索引。
- `autoRenameAttachmentsEnabled`：是否在新增或同步流程中自动按规则重命名主 PDF。
- `attachmentRenamePattern`：主 PDF 重命名规则。
