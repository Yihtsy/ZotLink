# ZotLink Development Notes

本文件记录 ZotLink 开发中容易反复踩坑的 Zotero 状态冲突、边界条件和排查原则。它面向后续开发，不是用户功能手册。

## README 待补充：首次使用建议

- 0.8.0 发布核对：已归入 README“使用建议与注意事项”，涵盖逐文件夹导入、先重建结构、完整出版社 PDF、网络要求和手动 DOI 纠错；未实现的全文识别开关仍仅为后续需求。

- 记录日期：2026-10-14。用户要求先记录，后续更新 README 时加入中英双语介绍。
- 不建议首次使用就将整库全部导入，建议先选择少量分类试用，再逐步处理。
- 推荐先根据本地文件夹重建子分类结构，再逐个文件夹导入 PDF，避免一次导入所有 PDF 导致长时间等待和卡顿；已写入 README 使用建议。
- 后续设置需求：增加“PDF 没有 DOI 元数据时，是否从文件内容识别 DOI”的勾选项；不建议批量使用该功能。
- 上述内容识别勾选项目前仅为需求记录，发布说明必须以实际实现为准，不能写成已有功能。仅在 PDF 缺少 DOI 元数据时考虑该回退，不替代元数据优先读取流程。
- 靠后排列的 PDF 来源建议（已加入 README 注意事项末尾）：建议优先导入出版社提供、保留原始排版的完整 PDF。尽量避免使用多来源拼接、内容缺失或大幅重排的版本，以减少因元数据缺失或页面结构变化导致的信息读取失败或识别偏差。

## 版本规则

- `0.x.0` 用于发布一组边界明确的新功能，例如 `0.4.0`。
- 同一功能阶段的调试、诊断和修复从 `0.x.1` 开始逐次增加 `0.0.1`，例如 `0.4.1`、`0.4.2`。
- 下一组明确的新功能进入下一个 `0.(x+1).0`，而不是继续占用上一功能阶段的调试版本号。
- 每次功能或行为更新都同步更新 `USER_MANUAL.md` 的适用版本与对应稳定功能编号。

## 分类文件夹合并与空目录清理

- 分类目标路径已经存在时，必须用移动操作逐项合并，不能复制后删除。
- 合并后删除源目录前必须重新枚举目录内容；只允许删除已确认为空的目录。
- 延迟删除任务不能只绑定路径，还必须绑定合并开始前读取的源文件夹 Windows 文件 ID。路径可以被后来创建的同名文件夹复用；机内码不一致时必须立即取消旧任务，绝不能删除新对象。
- 文件夹机内码只作为一次清理任务的临时身份令牌，不写入分类快照或全库索引。分类移动仍由 collection ID/key 与前后路径快照决定。
- OneDrive 目录可能在移动完成后短暂保持占用或延迟消失。删除失败时可以后台重试，但每次重试都必须重新确认目录为空。
- 后台清理首次检查应短暂延后（当前为 0.5 秒），给文件句柄释放留出时间；若 `IOUtils.remove()` 仍因访问受限失败，可以使用隐藏的原生 `os.rmdir()` 兜底，但必须在同一进程中再次核对文件夹机内码并确认目录为空。
- OneDrive 目录可能同时带有 `ReadOnly`、`Directory`、`Archive` 与 `ReparsePoint` 属性。即使 ACL 允许修改，`IOUtils.remove()` 和 `os.rmdir()` 也可能对空目录持续返回 `WinError 5`。通过身份与空状态检查后，可只清除源空目录的 `ReadOnly` 位再调用非递归 `os.rmdir()`；不得清除其他属性，也不得改用递归删除。
- 源目录清理由合并阶段创建的“路径 + 文件夹机内码”任务持续负责；附件同步阶段不得另起仅按路径删除的任务，因为路径可能已经被新文件夹复用。
- 后台重试删除前必须确认该路径不再对应任何当前分类。用户快速把分类移回原位置时，每次重试都应跳过删除；任务可以继续有限次数观察状态，但绝不能删除重新生效的目标目录。
- “当前仍是有效分类路径”只能跳过本次删除，不能永久结束清理任务；Zotero 的数据库或对象状态可能在拖拽完成后的短时间内仍显示旧父分类。后续重试仍须继续检查，直到确认安全删除或达到有限重试上限。
- 空目录后台清理应单独静默记录每次有效路径判断、空目录判断、子项数量和删除结果，避免只能从首次合并统计推测失败原因。
- 同一分类的多次待处理路径变化应合并为第一次旧路径到最终新路径；最终路径等于第一次旧路径时删除该待处理映射。
- 用户可见提示不显示诊断文件路径、内部 collection ID 或调试术语；诊断可继续在后台静默写入临时目录。

## Known State Conflicts

### 1. 回收站中的 collection 仍可能占用 ID 和名称

- 场景：用户删除某个子分类后，Zotero 可能仍在数据库中保留该 collection 记录。
- 风险：递归导入按同父级同名查重时，如果没有排除回收站记录，会误以为子分类已存在，从而不创建可见子分类。
- 当前策略：查找同父级同名子分类时，必须排除 `deletedCollections` 或 collection 对象上的 deleted/inTrash 状态。
- 诊断建议：subcollection 诊断中记录 `跳过回收站 collection`、父分类 ID、名称和旧 collection ID。

### 2. 回收站中的 item/attachment 仍可能被机内码索引命中

- 场景：PDF 或其父条目被删除到 Zotero 回收站，但 ZotLink 的旧机内码索引仍记录该附件。
- 风险：分类文件夹导入时先按机内码命中旧附件，随后跳过 DOI/ISBN 读取，导致本应重新导入的 PDF 被误判为已有。
- 当前策略：构建和查询机内码索引时，必须排除 `deletedItems` 中的附件和父条目。
- 诊断建议：如果机内码命中已有附件，需要记录 itemID、attachmentID、目标分类 ID、PDF 路径，以及该条目是否被判定为可见。
- 范围原则：机内码索引可以在全库范围内匹配，因为同一文件可能已属于其他分类；但命中后不能作为“全库已有即跳过”，必须继续判断该条目是否已属于当前目标分类，不属于则加入当前分类。
- 反证诊断：如果某个 PDF 最终进入“未发现 DOI/ISBN”分支，应记录当前 PDF 是否读到机内码，以及该机内码是否命中有效索引；这样可以区分“机内码没有命中”与“metadata 读取失败”。

### 2a. PDF metadata 可能存在于结构化 Info/XMP 中但不以明文出现在原始字节流

- 场景：pikepdf 能读到 `/doi` 和 `/doiURL`，但直接扫描 PDF bytes 找不到 `/doi` 或 DOI 字符串。
- 风险：旧版字节扫描器会误报“未发现 DOI/ISBN”，导致本应通过 DOI 匹配已有条目的 PDF 被跳过。
- 当前策略：`extractIdentifierFromPDFMetadata()` 优先调用 pikepdf 读取 `docinfo` 与 XMP metadata；pikepdf 不可用或未命中时，再回退旧字节扫描器。
- DOI 候选优先级：不能把全部 metadata 键值拼接后直接取第一个 DOI。应先读取明确 DOI 字段，再读取 `dc:identifier`，最后才扫描其他 metadata；同级候选应保留更完整的合法 DOI，避免章节 DOI 被同书的基础 DOI 截短。
- 诊断建议：遇到“PDF 明明有 DOI 但跳过”时，先用 pikepdf 探针查看 `pdf.docinfo` 与 `pdf.open_metadata()`，再判断是否是插件读取器问题。

### 3. 其他分类中已有同 DOI/ISBN 条目时不能重复创建

- 场景：同一 DOI/ISBN 的条目已经存在于其他分类，但当前分类文件夹中也有对应 PDF。
- 预期：不创建重复条目；把已有条目加入当前目标分类，并在必要时挂上链接附件或同步快捷方式分身。
- 风险：如果只把“库中已有 DOI/ISBN”当作跳过，会导致当前分类缺少该条目。
- 当前策略：全库 DOI/ISBN 查重命中后调用已有条目归入逻辑，而不是直接跳过。
- 诊断建议：导入诊断中区分 `归入：库中已存在 DOI/ISBN`、`已存在：已在目标分类`、`跳过：未发现 DOI/ISBN`。

#### 3a. 已有条目在其他分类里，且已有 PDF 附件

- 场景：目标文件夹中的 PDF 对应一个库中已有条目；该条目位于其他分类，并且已经有主 PDF 链接附件。
- 识别路径：优先可能通过机内码命中该已有附件；若机内码索引缺失，也可能通过 DOI/ISBN 命中已有条目。
- 预期：不新建条目；把已有条目加入当前目标分类；保持原主 PDF 或按既有多分类策略同步 `.lnk` 快捷方式分身。
- 风险：如果把机内码命中理解为“全库已有即跳过”，当前目标分类不会出现该条目。
- 诊断建议：记录命中方式、已有条目题名、itemID、attachmentID、原附件路径、目标分类路径，以及是否创建/刷新快捷方式。

#### 3b. 已有条目在其他分类里，但没有 PDF 附件

- 场景：目标文件夹中的 PDF 对应一个库中已有条目；该条目位于其他分类，但条目下没有主 PDF 附件。
- 识别路径：机内码无法命中，因为 Zotero 中没有可对应的附件索引；必须继续读取当前 PDF 的 DOI/ISBN metadata，再用 DOI/ISBN 匹配已有条目。
- 预期：不新建重复条目；把已有条目加入当前目标分类；把当前 PDF 作为链接附件挂到该已有条目下，并记录机内码。
- 风险：如果 PDF metadata 读取器读不到 DOI/ISBN，会误报“未发现 DOI/ISBN”，表现为已有无附件条目没有被归入、PDF 也没有挂载。
- 诊断建议：对这类跳过必须同时记录：当前 PDF 是否读到机内码、机内码是否命中有效索引、PDF metadata 读取结果、是否存在同题名候选条目。不要仅用“未发现 DOI/ISBN”概括。

### 4. Zotero 内存状态与 `collectionItems` 数据库状态可能不同步

- 场景：`item.getCollections()` 可能显示某条目已属于某 collection，但界面或数据库状态未同步，或者数据库已有记录但 UI 未刷新。
- 风险：插件误判“已在目标分类”，不再补写归属；或者写入数据库后 Zotero 左侧分类列表和中间条目列表未立即反映。
- 当前策略：判断条目是否属于目标分类时，以 `collectionItems` 数据库记录为准；写入或确认后显式通知 Zotero item/collection 变化并刷新 UI。
- 诊断建议：同时记录 `itemID`、`collectionID`、数据库是否已有记录、是否调用过 Zotero 通知。
- 后续修正：如果新旧同名 collection 并存，且旧 collection 已在回收站中，需要清理旧回收站 collection 的 `collectionItems` 归属；否则 Zotero UI 可能继续受旧归属干扰。
- 快捷方式同步：普通拖拽新增分类后，`item.getCollections()` 可能短暂保留旧缓存。镜像目标必须从 `collectionItems` 直接读取；`collection-item` 通知 ID 必须按 `<collectionID>-<itemID>` 提取后半段，不能把前半段分类 ID 一并当成条目 ID。

### 5. `Zotero.ProgressWindow` 可能影响分类树焦点或点击状态

- 场景：分类文件夹导入结束后，左侧分类树看起来无法点击，或点击后没有高亮。
- 风险：独立进度窗口残留、抢焦点或与硬弹窗叠加时，用户会误以为 Zotero 主界面卡住。
- 当前策略：分类文件夹导入只在开始和完成时使用右下角软提示；扫描与导入过程中不反复创建 `Zotero.ProgressWindow`。子分类通过 `collection.saveTx()` 触发 Zotero 原生通知，不再主动调用 `collectionsView.refresh()/invalidate()`，也不在结束后强制恢复焦点。
- 诊断建议：让用户区分“完全无法点击”与“没有蓝色高亮但中间列表已变化”；这两种情况对应不同 UI 层问题。

### 6. 递归导入中的同名子分类查重范围必须限定在同一父分类

- 场景：不同父分类下可以有同名子分类，例如 `统计学/包与软件引用` 与 `SPSS/包与软件引用`。
- 风险：如果扫描全库同名 collection，会误复用其他父分类下的子分类。
- 当前策略：只查询当前父分类直属子分类；不同父分类下允许同名。
- 两阶段原则：递归导入必须先完成整棵磁盘子文件夹到 Zotero 子分类的映射，再开始第二轮 PDF 扫描。PDF 扫描阶段只能读取既有映射，不得调用能够创建分类的路径确保函数。
- 性能原则：`IOUtils.stat()` 已明确返回普通文件时必须立即排除，不能继续调用 `IOUtils.getChildren()` 或启动 Python `os.path.isdir()`；外部目录判断只用于 stat 失败或类型未知的少数路径。
- 诊断建议：记录 root collection ID、parent collection ID、子分类名称、复用或新建的 collection ID。

### 7. 左侧 collection 本身移动时必须先迁移磁盘文件夹

- 场景：用户在 Zotero 左侧把某个分类拖到另一个分类下，或修改分类父级/名称。
- 风险：只创建新路径或只逐个同步附件，会留下旧磁盘文件夹不动；如果先移动了文件夹但未保留旧路径到新路径映射，Zotero 附件链接仍指向旧路径，后续同步会误报“源文件不存在”。
- 当前策略：检测到 collection path change 后，先按最上层受影响分类移动旧磁盘文件夹到新路径；若目标文件夹已存在，则递归合并内容，文件冲突时生成唯一文件名。随后把 oldPath/newPath 一并传给附件同步，旧链接失效时映射到新文件位置并更新 Zotero 链接。
- 旧路径来源：不能在拖拽结束后才首次读取旧 parent/path；必须依赖插件启动后持续维护的 `_collectionPathSnapshot`，在 `collection modify` 通知到达后读取新快照并比较。
- 触发边界：DOM `dragstart/drop` 只能作为条目拖拽的补充，不能覆盖分类路径旧快照；否则如果 drop 发生在 Zotero 已更新 collection 之后，会把“新状态”误写成“旧状态”，后续 Notifier 也无法检测变化。
- 窄兜底：`dragstart` 可以用于分类移动兜底，因为它比 `pointerdown/mousedown` 窄得多；疑似左侧分类树拖拽时，优先记录当前选中 collectionID 及其子树路径，drop/dragend 后只比较这棵子树，并在诊断来源中写出 `rootCollectionID`。只有无法确定选中分类时才退回更宽的快照。
- 父级字段：读取父分类时同时兼容 `parentID` 与 `parentCollectionID`；诊断中记录 old/new parent，便于确认是分类本身移动还是上级路径连带变化。
- 诊断策略：不要用延迟重试反复弹提示。若 `collection modify` 到达但没有路径变化，优先检查旧快照是否在此前被覆盖、父级字段是否读取正确，以及 `getCollectionPathByID()` 是否能反映当前树结构。
- 分类改名时序：实际测试表明，只依赖 `collection modify` 与长期维护快照可能拿不到改名前路径。`0.5.1` 起直接包装分类树的 `commitEditingName()`：在原方法修改并保存 `collection.name` 前同步建立旧路径快照，保存完成后立即比较当前子树。通知监听继续作为兜底，重复结果由路径变化签名去重。
- 嵌套分类快照：`Zotero.Collections.getByLibrary(libraryID)` 默认只返回顶层分类。建立改名前同步快照时必须显式传入递归参数 `true`，否则任意子分类都会缺少旧路径，表现为 Zotero 名称已改但磁盘文件夹不动。
- 条目分类通知：保留早期版本对 `collection-item` 参数的宽容解析，并优先处理标准 `<collectionID>-<itemID>` 形式；右侧 `文库和分类` 还可能伴随 `item modify` 与 `changed.collections`，应使用同一条 1.5 秒数据库确认流程。
- 通知防饥饿：附件同步队列共用计时器时，不得让后来的普通 `item modify` 把较早的分类变化任务从 1.5 秒重置为 5 秒。新通知可以合并 ID，但只能把执行时间提前，不能延后。
- 拖拽来源隔离：Zotero 在 `dragstart` 写入 `zotero/collection` 或 `zotero/item`。插件应在冒泡阶段读取该类型并保存一次拖拽周期变量；分类拖拽只保存分类路径快照，条目拖拽只保存条目分类归属快照。不能因中间条目列表仍有选中项而在一次 drop 后同时运行两套检查。
- 分类归属直接钩子：Zotero 的右侧分类勾选、`Item.addToCollection()`、`Item.removeFromCollection()` 以及 `Collection.addItems()/removeItems()` 最终都通过 `Item.setCollections()` 改变分类数组。notifier 之外应包装该入口；仅当前后分类签名确实变化时，将条目 ID 延迟入队，并在插件关闭时安全恢复原方法。
- 分类归属诊断：`setCollections()` 可能返回 Promise，必须在异步操作完成后再比较前后分类签名。诊断队列按条目保留 `setCollections`、notifier 或条目拖拽来源，最终记录文献题名、附件 key、数据库分类路径、目标路径和快捷方式创建错误；固定报告名为 `zotlink-membership-diagnostic-latest.txt`，方便复测后直接读取。
- 父级判定：仅监听 DOM drop 不能直接知道哪个 collection 被拖动；需要在快照中保存 `parentCollectionID`，比较同一 `collectionID` 的 parent 前后变化。`parentChanged=yes` 的 collection 是直接改父级的候选；`parentChanged=no` 但路径变化的 collection 多半是受上级移动连带影响。
- 去重原则：collection notifier 在同一次用户操作中可能多次触发；使用短时间 signature 去重，避免重复移动旧文件夹。
- 诊断建议：记录 moved/merged/skipped 数量、oldPath、newPath、oldFolder、newFolder；即使没有检测到路径变化，也要在软提示和诊断中写出 root collection 的前后路径和前后文件夹，以便判断是“抓错对象”还是“drop 后新路径没刷新”。如果附件同步仍显示源文件不存在，优先检查 `_pendingCollectionPathChanges` 是否同时保留了 `oldPath` 与 `newPath`。

### 8. 文件名弯引号导致快捷方式创建失败

- 发现与修复：`2026-10-11`，`0.5.6`。
- 正式整理：`0.6.0` 移除本案例排查新增的软弹窗，保留后台具体错误记录和回归测试。
- 典型文件名：`A voice-biomarker foundation model for ALS monitoring and Parkinson’s screening`，其中 `’` 为 U+2019；同类字符还包括 `‘`（U+2018）。
- 失败表现：分类变化通知已经捕捉，数据库有两个有效分类，目标路径计算正确，但快捷方式数量为零；外层只报 `wscript.exe failed`。其他文件换位成功，不能据此排除创建脚本的问题，因为文件名不同，也可能复用已有快捷方式。
- 根因：Windows PowerShell 单引号字符串也把英文弯引号识别为字符串边界；只转义 ASCII 单引号不足，脚本会在解析阶段失败。
- 处理：所有插入 PowerShell 单引号字符串的路径统一经过 `escapePowerShellSingleQuotedString()`，将普通单引号及 U+2018/U+2019 双写；保留原始文件名，不替换用户文件中的字符。新入口不得自行拼接未经转义的路径。
- 诊断：独立 launcher 捕捉被调用脚本的解析和运行错误，将具体错误与调用栈写入输出文件；外层执行器非零退出时先读取该文件，再汇报错误。不能仅依赖待执行脚本内部的 try/catch，因为它可能根本无法通过解析。
- 回归：`scripts/test-drag-source.js` 调用本机 Windows PowerShell，验证同时包含普通单引号、左右弯引号、空格和方括号的文件名可以原样往返。修改路径转义或隐藏执行器时必须保留该验证。
- 排查顺序：先确认动作捕捉，再确认最终分类与目标路径，最后检查执行器和具体脚本错误；不要因创建失败而反复改动已验证正确的分类监听逻辑。

## Diagnostic Principles

- 0.7.3 Windows PDF 批处理：每次外部调用原子提交 pdf-task.json，再竞争 pdf-batch.lock，由单一工作进程顺序处理并汇总结果。释放批锁后必须再检查任务目录，避免最后一次调用落在释放窗口而被遗留。任务与软提示完全不依赖 Zotero 进程；完成窗口非模态、定时销毁。
- 对齐页码的 DOI“无需重查”指不重复识别 DOI。用户要求定位正文不能全文提取，当前最多读前后各 3 页；先用 DOI/出版社与 Taylor & Francis、JSTOR、ProQuest、EBSCO 特征筛掉附加页，再结合 Crossref 标题与起止页码定位正文第一页。两张前置页加两张尾页、信息稀少的第二前置页及绝不提取中间页必须有回归测试。

- Windows PDF 工具（0.7.2）：将 PDF-DOI 工具中的引用命名、DOI 识别及页码计划独立快照迁入 content/windows-pdf/zotlink_pdf，不 import pydfdoi、不读取隔壁项目；Python 及 pikepdf/pypdf/requests 保留为运行依赖。新文件必须进入 WINDOWS_PDF_FILES 释放白名单和打包清单。
- PDF 菜单用当前用户 SystemFileAssociations/.pdf/shell/ZotLink 的 MUIVerb/SubCommands/shell 级联方式注册；目录菜单仍独立。禁用/卸载删除两处自有键，正常退出/升级不删除；清理助手仅删除已知文件。test-windows-folder.js 同时覆盖两类注册脚本与 bootstrap 生命周期。
- DOI 入口：Info /doi 存在则禁止页面回退，即使其无效也应提示修正。doiURL 仅派生，不识别文献。只有缺少 /doi 才扫描页面文字；将这一主动识别路径与分类导入的“只读 metadata”策略分开，不能全局改写。
- PDF 写回先输出到临时文件并校验，再写入原文件句柄，避免替换源文件导致机内码改变；失败恢复也不替换源文件。页码对齐不能把超过 PDF 页数的范围截断后默认为成功。
- 独立 Python 工具完成后通过 pdf-result.json 通知运行中的 ZotLink；关闭期间累积结果待下次启动，按已有索引附件更新链接和分身。PDF 操作本身不要求 Zotero 开启。

- Windows 菜单 AppliesTo 使用规范 AQS：System.ItemPathDisplay 精确匹配根目录，或用 ~< 匹配“根目录 + 路径分隔符”前缀；不能直接匹配无分隔符前缀，否则同名开头的兄弟目录会误显示。根目录设置变更后更新注册表条件，并串行化更新以避免旧写入覆盖新设置。

- Windows PowerShell 5.1 对无 BOM UTF-8 JSON 默认可能按系统 ANSI 读取，所有跨进程 JSON 读取必须显式指定 UTF-8，尤其是含中文错误提示的返回文件。原生助手缓存根目录供提前判断，但最终请求仍由 Zotero 按当前设置复核。

- Zotero 10 的 `Zotero.File.getContentsAsync()` 对 URI 会转交 HTTP.request；实际 jar 读取会在 HTTP._parseURI 访问 nsIURI.username 时触发 NS_ERROR_FAILURE，允许状态码 0 也无效。必须用系统 principal 创建原生 nsIChannel，再交给 getContentsAsync(channel, "UTF-8") 的流读取分支。空助手目录而没有脚本和注册键时，应先排查资源读取。

- Windows 文件夹菜单仅注册 `HKCU\\Software\\Classes\\Directory\\shell\\ZotLinkLocateCollection`，助手只放在当前用户 LocalAppData 的 ZotLink/windows-menu 中。卸载只删除自有注册键及白名单助手/请求文件。
- 助手使用隐藏 VBS 启动 PowerShell，将 GUID 请求通过临时文件原子改名提交；插件顺序处理请求、限制有效期并验证根目录边界，再复用同父级分类去重流程。不能因相似路径前缀而允许根目录外创建分类。
- 正常关闭 Zotero 不删除菜单，助手负责检查 Zotero 进程并提示；禁用或卸载删除菜单，升级保留并重写助手。每次加载重新注册，以修复意外中断造成的缺失。
- 回归验证：`scripts/test-windows-folder.js` 检查根内路径映射、相似前缀根外路径拒绝、根目录选中文库与任务锁释放。

- 对“已存在”“归入”“跳过”使用不同诊断词，不要把成功归入算作跳过。
- 凡涉及查重，诊断中至少记录：PDF 路径、识别方式（机内码/DOI/ISBN）、命中的 itemID 或 collectionID、目标分类 ID。
- 凡涉及 Zotero 回收站，诊断中明确写出“回收站/已删除记录”，避免与普通重复混淆。
- 对用户弹窗保持简洁；复杂细节写入临时诊断文件或开发日志。
- PowerShell 文件路径：单引号字符串还把 U+2018/U+2019 当作边界，必须同普通单引号一样双写转义；已复现 `Parkinson’s` 导致解析失败。隐藏执行器用独立 launcher 捕捉被调用脚本的解析及运行错误，写入输出文件后再返回非零退出码。

## Article History Ownership (0.7.5)

- All article-history extraction, date-row registration, automatic observers, settings and manual actions belong to Zotero Literature Fields 0.1.75. Do not register duplicate rows or add a runtime dependency on ZotLink there.
- Existing Extra keys remain unchanged. The old ZotLink auto-extraction preference is retained as migration input, never an active ZotLink setting.
- Bulk PDF preferences use independent bulk-prefixed keys; defaults must not fall back to single-file settings. Root-folder reconstruction stays the first bulk action.
