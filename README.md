# ZotLink

ZotLink 是一个面向 Zotero 7 的 Windows 链接附件管理插件。它把 PDF 文件放在可直接浏览、可独立使用的文件夹体系中，同时为 Zotero 记录稳定的文件身份，减少“Zotero 能看到条目，但附件文件已经找不到”的情况。

当前版本：`0.3.0`

作者：Yihtsy <yihtsy@outlook.com>

## 为什么做 ZotLink

Zotero 原生链接附件只记录一个附件路径。用户如果在资源管理器、Everything、同步盘或其他文件管理器中重命名、移动 PDF，Zotero 记录的路径就可能失效；而很多人又希望 PDF 文件不被锁在 Zotero storage 里，而是仍然能作为普通文件独立使用、搜索、同步、备份和整理。

ZotLink 的目标是让 Zotero 与外部文件系统协作，而不是让其中一方完全接管另一方。

## 核心特性

- 按 Zotero collection 层级移动链接附件。
- 以复制形式拖入 Zotero storage 的文件附件，会自动移出到指定目录并改为链接附件。
- 使用 Windows 机内码和附件路径双重记录真实文件身份。
- 打开或定位附件前，如果 Zotero 记录路径失效，会尝试按机内码找回真实文件。
- 一个条目属于多个 collections 时，Zotero 仍只绑定一个真实附件路径，其他 collection 目录下创建 `.lnk` 快捷方式。
- Shift+拖拽条目到其他 collection 时，真实文件会移动到新 collection 对应目录。
- 支持从左侧 collection 对应文件夹批量导入 PDF，并按 PDF metadata DOI 创建 Zotero 条目。
- 支持把父条目的 DOI 写入 PDF 源文件 metadata：`/doi` 与 `/doiURL`。
- 支持按规则重命名主 PDF，例如 `{author} {year} {title}`，默认不启用。
- 支持初始化全库附件机内码。

## 0.3.0 重要变化

`0.3.0` 是 ZotLink 的第一个正式大版本发布准备版，也是一项会修改 PDF 源文件的大改动：

- PDF DOI metadata 写回成为正式功能：当父条目存在 DOI 时，ZotLink 可向 PDF 源文件补写 `/doi` 与 `/doiURL`。
- 如果 PDF 已经同时存在 `/doi` 和 `/doiURL`，ZotLink 会跳过，不覆盖已有 metadata。
- 如果只存在其中一个字段，ZotLink 会补写缺失字段。
- 新增可配置的主 PDF 重命名功能，默认关闭。
- 条目右键菜单 `ZotLink -> 按规则重命名主 PDF` 可手动执行重命名。
- 右键普通条目时，只处理该条目的主 PDF；右键具体 PDF 附件时，只处理该附件。

建议首次使用 `0.3.0` 的 PDF 写回和重命名前，先备份附件目录或使用同步盘历史版本。

## 与 Attanger、ZotFile、ZotMoov 的区别

### Attanger

[Attanger](https://github.com/MuiseDestiny/zotero-attanger) 是目前仍活跃的 Zotero 附件管理插件，重点包括附件移动、复制、重命名、匹配最近下载文件，以及使用 Zotero 原生重命名模板等。Attanger 更接近通用附件整理器。

ZotLink 的重点不同：

- 以 Windows 文件身份为核心，记录机内码与路径。
- 优先解决“外部改名或移动后，Zotero 附件脱钩”的问题。
- 面向 Zotero collection 与外部文件夹长期保持对应关系。
- 多 collection 场景使用真实文件加 `.lnk` 镜像，而不是让 Zotero 绑定多个真实路径。
- 支持把 DOI 写回 PDF metadata，让 PDF 离开 Zotero 后仍带有可读的标识信息。

### ZotFile

[ZotFile](https://github.com/jlegewie/zotfile/blob/master/readme.md) 是 Zotero 附件管理的经典前辈，曾提供 PDF 重命名、移动、平板同步、注释提取等功能。它的 README 已说明项目当前不再积极维护，更新很少。ZotLink 借鉴的是“让附件脱离 storage、进入可读文件夹”的思路，但实现目标更窄：专注链接附件、collection 路径、文件身份索引和链接修复。

### ZotMoov

[ZotMoov](https://github.com/wileyyugioh/zotmoov/blob/master/README.md) 是 Zotero 7 时代的轻量附件移动工具。ZotLink 与 ZotMoov 的一个关键差异是：ZotLink 尽量使用移动操作处理附件迁移，而不是“复制到目标位置后删除原文件”。在同一个 NTFS 卷内移动时，文件机内码通常保持不变，因此更适合 ZotLink 的文件身份追踪。

ZotLink 还额外记录机内码与附件路径，用于处理用户在资源管理器中改名、移动 PDF 后 Zotero 链接失效的问题。

## 为什么没有选择硬链接

ZotLink 曾在 `0.1.15` 使用硬链接模式处理多 collection 场景：同一个文件实体可以出现在多个 collection 文件夹中，且机内码相同。这个方案技术上可行，也能减少真实文件重复。

最终从 `0.2.0` 起改为 `.lnk` 快捷方式，原因是：

- Zotero 附件条目本身只支持一个绑定文件路径，硬链接会让“哪个路径才是主路径”变得不直观。
- Everything、同步盘和普通文件管理流程对硬链接的呈现不一定符合用户预期。
- 删除某个硬链接路径时，用户容易误以为删除了文件本体，或反过来以为残留路径应该自动消失。
- 不同 collection 下硬链接文件名可以不同，但它们指向同一个文件实体，文件名同步和路径反推会带来额外复杂性。
- `.lnk` 更明确：真实 PDF 只有一份，其他 collection 文件夹里的是入口和镜像。

硬链接相关代码仍保留在源码中作为 legacy/reference，方便以后研究或开源后供他人参考。

## 使用方式

1. 在 Zotero 插件管理器中安装 `zotlink-0.3.0.xpi`。
2. 重启 Zotero。
3. 在 ZotLink 设置中填写附件移动顶层路径，例如 `D:\OneDrive\Zotero`。
4. 选中文献条目或附件，使用右键菜单 `ZotLink -> 移动附件到集合目录`。
5. 普通拖拽条目到另一个 collection：保留真实文件主路径，并在新增 collection 目录创建 `.lnk`。
6. Shift+拖拽条目到另一个 collection：移动真实文件到新 collection 目录，并刷新其他 `.lnk`。

## PDF 重命名

设置页提供：

```text
为新增或同步的主 PDF 按规则重命名
PDF 重命名规则
```

默认规则：

```text
{author} {year} {title}
```

可用占位符：

- `{author}`：第一作者姓氏或名称。
- `{authors}`：第一作者；多作者时使用 `第一作者 et al.`。
- `{year}`：条目年份。
- `{title}`：条目标题。
- `{doi}`：条目 DOI。

自动重命名默认关闭。启用后，ZotLink 只会在新增或同步流程中重命名主 PDF，不会批量改动同一条目下的全部 PDF。也可以通过条目右键菜单 `ZotLink -> 按规则重命名主 PDF` 手动执行。

## 从 Collection 文件夹批量导入 PDF

在 Zotero 左侧 collection 上右键，选择：

```text
ZotLink -> 仅导入当前文件夹 PDF
ZotLink -> 导入当前文件夹及子文件夹 PDF
```

`仅导入当前文件夹 PDF` 只扫描当前 collection 对应磁盘文件夹第一层的 PDF。

`导入当前文件夹及子文件夹 PDF` 会递归扫描子文件夹，并把子文件夹映射到 Zotero 子 collection；如果同名子 collection 不存在，ZotLink 会先创建。

导入时，ZotLink 会优先读取 PDF Info/XMP metadata 中的 DOI 字段，例如 `doi`、`DOI`、`prism:doi`、`dc:identifier` 等；识别 DOI 后调用 Zotero 搜索翻译器获取完整元数据，再把本地 PDF 作为链接附件加入目标 collection。

如果目标 collection 中已经存在相同 DOI 的条目，ZotLink 会跳过该 PDF。当前版本不会做全文识别；如果 DOI 不在 metadata 或轻量扫描范围内，会跳过。

## PDF DOI 元数据写回

ZotLink 会在附件同步流程中尝试把父条目的 DOI 写入 PDF 源文件 metadata：

- 写入字段：`/doi` 与 `/doiURL`。
- 写入工具：通过 Python 调用 `pikepdf`。
- 触发时机：新增/导入 PDF 文件附件、storage 附件被移出并转为链接附件、附件路径同步后。
- 跳过条件：父条目没有 DOI、附件不是 PDF、源文件不存在，或 PDF 中已经同时存在 `/doi` 和 `/doiURL`。
- 若 PDF 中已有 `/doi` 但缺少 `/doiURL`，ZotLink 会只补写 `/doiURL`；反过来也一样。

设置页提供 `写入全库 PDF DOI 元数据` 按钮，可对当前个人库里的 PDF 附件统一执行一次。若当前 Python 环境缺少 `pikepdf`，结果中会显示 `缺少 pikepdf`。

条目右键菜单的 `ZotLink -> 写入 PDF DOI 元数据` 可只对当前选中范围执行：

- 右键普通条目时，只处理该条目的主 PDF。
- 右键具体 PDF 附件时，只处理该附件。

## 索引数据

ZotLink 将附件索引存储在 Zotero preferences：

```text
extensions.zotlink.attachmentFileIndex
```

每条索引以附件 item key 为主键，主要字段包括：

- `fileID`：Windows 机内码。
- `primaryPath`：Zotero 当前绑定的真实附件路径。
- `shortcutPaths`：其他 collection 目录下的 `.lnk` 快捷方式路径。
- `path`：兼容旧版本的主路径字段，等同于 `primaryPath`。
- `hardlinkPaths`：旧硬链接模式遗留字段，`0.2.0` 会逐步清理。

## 与 Zotero Literature Fields 的关系

从 Zotero Literature Fields `0.1.55` 开始，字段功能和链接附件功能已经拆分：

- Zotero Literature Fields：负责文献类型、自定义字段和主列表字段列。
- ZotLink：负责链接附件移动、机内码索引、collection 镜像、附件链接修复、PDF DOI metadata 写回和主 PDF 重命名。

两个插件使用不同的插件 ID 和偏好设置前缀，可以独立安装和维护。

## 发布说明

GitHub Release 建议包含：

- `zotlink-0.3.0.xpi`
- `updates.json`
- `README.md`
- `VERSION_LOG.md`

Zotero 插件市场说明建议突出：

- Windows 链接附件管理。
- 文件机内码与路径双重索引。
- 外部改名或移动后的附件修复。
- Collection 文件夹镜像。
- PDF DOI metadata 写回。
- 可选主 PDF 自动重命名。

## 注意事项

- ZotLink 当前主要面向 Windows，因为机内码、`.lnk` 和 NTFS 移动语义都依赖 Windows。
- `.lnk` 快捷方式不是 Zotero 附件本体；Zotero 仍只绑定真实文件路径。
- `0.3.0` 的 DOI metadata 写回会修改 PDF 源文件，请在首次全库执行前备份附件目录。
- 如果你从 `0.1.x` 硬链接版本升级，建议先备份附件目录。`0.2.0+` 会在同步时清理旧硬链接镜像并创建快捷方式。
- OneDrive 等同步盘可能会短暂显示同步中的临时状态，但 ZotLink 的真实文件迁移仍使用移动操作。

## 版本记录

详见 [VERSION_LOG.md](VERSION_LOG.md)。
