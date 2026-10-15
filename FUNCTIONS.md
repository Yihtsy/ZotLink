# ZotLink 功能细化

适用版本：`0.8.0`

开发中的 Zotero 状态冲突、回收站残留、跨分类重复条目和 UI 刷新问题，统一记录在 `DEVELOPMENT_NOTES.md`。

## Windows PDF 右键工具

- PDF 文件右键 ZotLink 子菜单：Update DOI metadata only、Rename article/book、Align PDF page labels。
- 三项命令关闭 Zotero 后仍可运行，批量调用合并排队并用自动消失的非模态软提示汇报；命名已一致时不重命名。页码对齐也负责 DOI 元数据补写，用出版社特征及最多前后各 3 页的线索定位正文，不遍历中间页文字。
- XPI 加载时注册当前用户菜单并释放独立 Python 助手；禁用或卸载清理；无需 pydfdoi，保留 Python 及 pikepdf、pypdf、requests 依赖。
- DOI 元数据存在时禁止页面覆盖，只有缺失 /doi 才扫描前 20 页；doiURL 始终按 doi 补全或修正。
- 引用式命名保留原作者/编者、出版社年份、书籍版本和 280 字符路径策略。页码只处理具有常规页码范围的篇章，额外前置第一页为 cover page。
- 功能入口、限制和行为详见 USER_MANUAL.md 的 I1-I4。

## 附件管理目标

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
- 自动同步实际新增分身后，显示一条 ZotLink 软通知，说明多分类归属及新增数量；已存在分身的重复检查不通知。
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
- `collection-item` 通知优先按 `<collectionID>-<itemID>` 解析，同时保留旧版对其他通知参数形式的宽容提取；右侧 `文库和分类` 触发的条目 `modify` 通知也会识别 `changed.collections`。
- 同时包装 Zotero `Item.setCollections()` 作为直接触发保障；分类数组发生真实变化时记录父条目 ID，等待保存后从数据库读取最终归属并同步 `.lnk`。
- 为 `setCollections()`、Zotero notifier 与条目拖拽分别记录触发来源；数据库最终分类数、目标路径及分身结果静默写入 `zotlink-membership-diagnostic-latest.txt`。`0.6.0` 起移除临时诊断软弹窗，保留正常操作提示。
- 拖拽完成后等待约 1.5 秒，再从 `collectionItems` 和分类数据库快照读取最新归属与路径，避免 `item.getCollections()` 缓存尚未刷新而漏建 `.lnk`。
- `dragstart` 会记录本次来源是分类还是条目；分类 drop 只处理文件夹迁移，条目 drop 只处理分类归属与 `.lnk`，两者不会交叉触发。
- 分类变化任务使用最早截止时间执行；后续普通条目通知只能合并待处理条目，不能把已经排定的快捷方式同步继续向后推迟。
- 拖拽结束后使用短状态提示或 debug 日志记录变化，不再弹出确认对话框。
- 分类内联重命名时，在 Zotero 提交新名称前递归记录完整分类树旧路径；保存完成后移动或合并对应磁盘目录，并重建下属附件链接与快捷方式。分类 `move` 通知也纳入相同流程。

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

## 打开分类目录

- 左侧分类右键菜单第二组在原生 `重命名` 后提供 `打开分类目录`，不放在 `ZotLink` 子菜单中。
- 按设置的附件顶层路径和分类层级计算 Windows 目录。
- 目录不存在时递归创建，然后调用 Zotero 的系统文件打开接口进入该目录。
- 菜单项只在单选普通分类时显示，并复用 Zotero “打开文件目录”的图标样式。

## 从顶层文件夹重建链接库

- 设置页新增 `从顶层文件夹重建链接库` 按钮。
- 从 `attachmentMoveRoot` 开始递归扫描所有子文件夹中的 PDF。
- 读取 PDF metadata 中的 DOI；没有 DOI 的 PDF 会跳过。
- 如果当前 Zotero 个人库中已经存在相同 DOI 的未删除条目，则跳过，避免重复导入。
- 按磁盘相对路径自动创建或匹配 Zotero collection 层级。
- 成功识别 DOI 的 PDF 会通过 Zotero 搜索翻译器创建条目，并作为链接附件加入对应 collection。
- 这个功能用于在 OneDrive 等同步盘中保留固定 PDF 文件夹结构，并在跨机器迁移后快速重建 Zotero 链接附件库。

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

## 独立 Windows PDF 右键工作流

- XPI 加载后注册 PDF 右键 ZotLink 菜单，禁用或卸载清理；已注册后关闭 Zotero 仍可使用。
- 更新 DOI 元数据、引用式重命名、对齐 PDF 页面标签；无需预先导入文献。
- 重命名和页码对齐查询 Crossref，需联网；仅写入本地 DOI 可离线完成。
- 连接 5 秒、读取 20 秒超时，不自动重试；网络异常中文软提示，单文件失败后继续批处理。

## 设置

- 单文件自动处理与全库更新项目独立保存，单文件勾选不再决定全库操作。
- 单文件保留原默认值；全库默认仅勾选 DOI 元数据，页码及查看设置默认关闭。
- 全库区域首行左侧“从顶层文件夹重建链接库”、右侧“检查并修复全库附件链接”；下方为独立勾选项目及更新按钮。
- 投稿历史的实现、字段、设置与右键入口由 ZotFields（原 Zotero Literature Fields）独立提供，ZotLink 不再处理。

- `attachmentMoveRoot`：附件移动和修复扫描的顶层路径。
- `attachmentMoveShortcut`：移动附件快捷键。
- `copyLinkShortcut`：复制 DOI/URL 链接快捷键。
- `copyObsidianLinkShortcut`：复制 Obsidian 文献链接快捷键。
- `lastMoveReport`：最近一次移动或修复结果。
- `lastIndexReport`：最近一次全库初始化结果。
- `attachmentFileIndex`：附件机内码索引。
- `autoRenameAttachmentsEnabled`：是否在新增或同步流程中自动按规则重命名主 PDF。
- `attachmentRenamePattern`：主 PDF 重命名规则。
