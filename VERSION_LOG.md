# ZotLink 版本记录

## 当前版本：0.3.1

### 本版变化

- 重整公开 README：删除发布说明，合并首次发布说明到核心特性，将功能说明统一放入 `功能介绍`，并把同类插件对比移入 `为什么做 ZotLink`。
- 修复删除或移除条目/collection 关系时，ZotLink 后台同步误用当前选中条目作为兜底来源，可能弹出 Zotero 设置/报告窗口的问题。

## 0.3.0

### 本版变化

- 准备正式发布到 GitHub 与 Zotero 插件市场，同步更新 README、功能说明和发布说明。
- 将 PDF DOI metadata 写回作为 `0.3.0` 大版本功能正式记录：通过 Python `pikepdf` 向 PDF 源文件补写 `/doi` 与 `/doiURL`。
- 新增可配置的主 PDF 重命名功能，默认关闭；默认规则为 `{author} {year} {title}`。
- 条目右键菜单 `ZotLink -> 按规则重命名主 PDF` 可手动执行重命名。
- 右键普通条目时只处理该条目的主 PDF；右键具体 PDF 附件时只处理该附件。
- 自动新增或同步附件时，若启用自动重命名，也只处理主 PDF，并在重命名后刷新 Zotero 链接路径、机内码索引和 collection 快捷方式镜像。
- 文档新增与 Attanger、ZotFile、ZotMoov 的区别说明，并解释 `0.1.15` 硬链接方案为何从 `0.2.0` 起改为 `.lnk` 快捷方式方案。

## 0.2.18

### 本版变化

- 优化设置页 `写入全库 PDF DOI 元数据` 按钮：执行时不再创建额外进度窗口或最终系统弹窗，避免设置窗口被抢焦点或最小化；进度显示在按钮文字上，结果使用右下角软提示。

## 0.2.17

### 本版变化

- 条目右键菜单 `ZotLink` 下新增 `写入 PDF DOI 元数据`。
- 右键普通条目时只处理该条目的主 PDF；即使条目下存在多个 PDF 附件，也不会批量修改所有 PDF。
- 右键具体 PDF 附件时只处理该附件。

## 0.2.16

### 本版变化

- 修正 PDF DOI 元数据写回条件：只有 `/doi` 和 `/doiURL` 都已存在时才跳过；如果已有 `/doi` 但缺少 `/doiURL`，会补写 `/doiURL`。

## 0.2.15

### 本版变化

- 新增 PDF DOI 元数据写回：读取父条目的 DOI，通过 Python `pikepdf` 写入 PDF 源文件 `/doi` 与 `/doiURL`，已有 DOI metadata 时跳过。
- 新增设置页按钮 `写入全库 PDF DOI 元数据`，可对当前个人库 PDF 附件统一执行。
- 新增附件同步触发：新增/导入 PDF 文件附件并挂在条目下后，会在移动、索引和镜像同步后尝试写入 DOI metadata。

## 0.2.14

### 本版变化

- PDF DOI metadata 读取继续增强：支持解析 PDF literal string 中的八进制转义，例如 Python PDF 库可能写出的 `\376\377\0001...` UTF-16 字符串。

## 0.2.13

### 本版变化

- 修复部分 Zotero 版本或启动时序下 collection 右键菜单未插入的问题；现在会在右键菜单弹出时做保底动态注册。
- PDF DOI metadata 读取增强：兼容 UTF-8、UTF-16BE/LE、带 BOM 的 UTF-16 和 PDF 十六进制字符串，并补充扫描未被 `/Metadata`/`/Info` 引用模式捕捉到的 metadata-like 对象，减少“PDF 明明有 DOI 但提示未发现 DOI”的情况。

## 0.2.12

### 本版变化

- 撤回 `0.2.11` 的“拖入 PDF 优先接管”实验功能，避免与 Zotero 官方 PDF 元数据识别并发运行时造成重复条目。
- 新增 PDF 附件仍会继续走原有的 storage 附件移动、链接附件转换、机内码索引和 collection 镜像同步流程。

## 0.2.11

### 本版变化

- 新增实验功能：拖入 Zotero 的顶层 PDF 会优先尝试读取 metadata DOI；成功后 ZotLink 会按 DOI 创建/匹配条目、改挂 PDF、移动为链接附件并记录机内码。
- 对已有父条目的 PDF 不强行改父条目，只继续走原有移动、索引和镜像流程。

## 0.2.10

### 本版变化

- Collection 文件夹导入 PDF 的完成、跳过和错误提示改为 Zotero 右下角软提示，不再使用必须点击确定的系统弹窗。

## 0.2.9

### 本版变化

- 修复部分 PDF XMP metadata 中 DOI 后面紧跟 RDF/URI 残尾时被误读的问题，例如 `10.3389/fpsyg.2021.643120)/s/uri` 现在会清洗为 `10.3389/fpsyg.2021.643120`。

## 0.2.8

### 本版变化

- Collection 右键导入 PDF 拆分为两个入口：`仅导入当前文件夹 PDF` 与 `导入当前文件夹及子文件夹 PDF`。
- 非递归导入只扫描当前 collection 对应磁盘文件夹第一层。
- 递归导入会按磁盘子文件夹映射 Zotero 子 collection；若对应同名子 collection 不存在，会自动创建后再导入。

## 0.2.7

### 本版变化

- PDF DOI 提取进一步改为优先按字段读取 Info/XMP metadata 中的 `doi`、`DOI`、`prism:doi`、`dc:identifier` 等 DOI 字段，再退回 metadata 块内 DOI 搜索和轻量字节兜底。
- 保持 Collection 文件夹导入的递归扫描行为：会扫描当前 collection 对应文件夹下的子文件夹。

## 0.2.6

### 本版变化

- PDF DOI 提取改为先解析 PDF Info/XMP metadata 中的 DOI，再使用轻量字节搜索兜底，减少 metadata 中存在 DOI 但未被识别的情况。
- 文档明确说明：Collection 文件夹导入会递归扫描子文件夹，但导入条目目前加入右键选中的 collection，不自动映射到 Zotero 子 collection。

## 0.2.5

### 本版变化

- 修复 Collection 文件夹导入 PDF 时 DOI 查重会把已删除/回收站条目计入的问题；现在只统计当前 collection 中未删除的普通条目。

## 0.2.4

### 本版变化

- Collection 文件夹批量导入 PDF 时，提取 DOI 后改为调用 Zotero 搜索翻译器补全元数据，效果接近 Zotero “通过标识符添加条目”的魔法棒功能。
- DOI 查询失败时仍会退回到基础 DOI 条目，避免批量导入中断。

## 0.2.3

### 本版变化

- 左侧 collection 右键菜单新增 `ZotLink -> 从此 Collection 文件夹导入 PDF`。
- 新功能会扫描 collection 对应文件夹中的 PDF，优先从 PDF metadata/XMP 附近提取 DOI，创建 Zotero 条目并添加链接附件。
- 如果当前 collection 中已经存在相同 DOI，则跳过，避免重复添加。
- Collection 变化同步不再弹出确认对话框，仅保留短状态提示/debug 记录。

## 0.2.2

### 本版变化

- 修复从多 collection 条目中移除副 collection 后，对应 collection 文件夹里的 `.lnk` 没有被删除的问题。

## 0.2.1

### 本版变化

- 修复 Shift+拖拽移入 collection 后，新主路径所在文件夹中原有 `.lnk` 没有被删除的问题。

## 0.2.0

### 本版变化

- 默认多 collection 镜像方式从硬链接改为 Windows `.lnk` 快捷方式。
- Zotero 仍只绑定一个真实附件主路径；其他 collection 目录下创建快捷方式。
- 普通拖拽新增 collection 时创建 `.lnk`；Shift+拖拽移动 collection 时移动真实文件并刷新 `.lnk`。
- 索引结构新增 `shortcutPaths`，旧 `hardlinkPaths` 保留用于迁移和清理。
- `0.1.15` 是最后一个默认使用硬链接的实验版本；硬链接相关代码在 `0.2.0` 中保留为 legacy/reference，但默认同步流程不再调用。

## 0.1.15

### 本版变化

- 撤回 `0.1.14` 的 WScript+cmd 包装方式，改用无控制台的 `pyw.exe` 直接运行 Python `os.link()`，避免黑色命令行窗口并恢复 `0.1.13` 的硬链接创建路径。
- 添加 collection 创建硬链接失败后不再回退到可见的 `cmd mklink` / PowerShell 路径，避免失败时继续闪出黑色窗口。

## 0.1.14

### 本版变化

- Python `os.link()` 硬链接创建改为通过隐藏 WScript 运行，避免添加 collection 创建硬链接时闪出黑色命令行窗口。

## 0.1.13

### 本版变化

- 硬链接创建新增 Python `os.link()` 优先路径，绕开 Zotero 中 `cmd.exe` / PowerShell 调用失败的问题。
- 硬链接创建成功后会比对源路径与目标路径的机内码，确认两者确实指向同一个文件实体。

## 0.1.12

### 本版变化

- 支持 Zotero 中 Shift+拖拽到其他 collection 的移动语义：检测到旧 collection 被移除且新增 collection 存在时，优先将附件主路径移动到新增 collection 对应文件夹。
- 如果新增 collection 目标路径已存在同一机内码的硬链接，会将 Zotero 主路径切换到该硬链接并删除旧路径。

## 0.1.11

### 本版变化

- 取消同步完成后的长篇“ZotLink 硬链接诊断”弹窗，只保留 collection 变化被捕捉时的短提示。
- 条目移入其他 collection 且当前主路径不再属于目标 collection 时，主文件改为立即移动到新 collection 路径，而不是先创建硬链接再删除旧路径。
- 修正 `mklink /H` 命令里的路径引号写法，提高添加 collection 时创建硬链接的成功率。

## 0.1.10

### 本版变化

- 保留条目 collection 变化的即时捕捉弹窗，并显示新增/移除 collection 归属数量。
- 拖拽导致 collection 变化后立即同步对应条目的硬链接和主路径；添加 collection 时马上创建硬链接，移入其他 collection 时主文件路径马上跟随移动。

## 0.1.9

### 本版变化

- 拖拽触发后的同步范围收窄为本次 collection 变化的条目，不再运行已索引附件的全量 collection 诊断。
- 硬链接创建命令改用通用诊断执行器，避免 `mklink` / PowerShell 输出被机内码解析逻辑误判，创建失败时显示更真实的命令结果。

## 0.1.8

### 本版变化

- 硬链接创建增加 PowerShell `New-Item -ItemType HardLink` 兜底；`mklink /H` 失败后会自动尝试第二种创建方式。
- 硬链接诊断中显示目标路径列表、已创建硬链接列表，并在只检测到一个 collection 路径时明确提示“不需要额外硬链接”。

## 0.1.7

### 本版变化

- 增加条目拖拽触发侦测：拖拽开始/放下后比对被拖条目的 collection 归属变化，用于触发硬链接同步并显示诊断。

## 0.1.6

### 本版变化

- 增加 collection 变化后的硬链接诊断弹窗，用于区分“没有触发同步”和“触发后创建失败”。
- 硬链接创建失败时，在诊断中显示源路径、目标路径和命令输出。
- 将 ZotLink 状态提示窗口标题修正为 `ZotLink`。

## 0.1.5

### 本版变化

- collection 成员变化时不再只依赖 Zotero 通知里的 item id，而是对已索引附件执行一次硬链接全量同步，修复拖拽条目到另一个 collection 后未创建硬链接的问题。
- 修正硬链接同步结果的 `changed` 判断，便于后续诊断。

## 0.1.4

### 本版变化

- 修复条目加入或移出 collection 时不触发硬链接同步的问题；现在额外监听 Zotero 的 `collection-item` 通知。

## 0.1.3

### 本版变化

- 新增多 collection 硬链接同步：一个附件保留一个 Zotero 主路径，其他 collection 目录自动创建硬链接。
- collection 归属变化时，会自动新增/删除对应硬链接；主路径所在 collection 被移除时，会切换主路径。
- 索引结构升级为 `primaryPath` + `hardlinkPaths`，兼容旧 `path` 字段。
- 硬链接文件名同步以主路径文件名为准，发现已知硬链接被改名时会尝试按机内码找回并重命名。

## 0.1.2

### 本版变化

- 新增复制拖入 Zotero 后的自动迁移：检测到 storage 中的文件附件时，自动移动到 ZotLink 指定目录、改为链接附件、记录机内码，并删除原 storage 子目录。

## 0.1.1

### 本版变化

- 添加 ZotLink Logo，并写入 manifest `icons`，用于 Zotero 插件管理器显示。

## 0.1.0

### 本版变化

- 从 Zotero Literature Fields 拆分为独立插件。
- 保留链接附件移动、机内码记录、全库初始化和附件链接修复功能。
- 使用独立插件 ID：`zotlink@example.com`。
- 使用独立偏好前缀：`extensions.zotlink.`。
