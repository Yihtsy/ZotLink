"use strict";

(function () {
	const LFServices = typeof Services !== "undefined" ? Services : null;

	const PREF_PREFIX = "extensions.zotlink.";
	const PLUGIN_ID = "zotlink@local";
	const ITEM_MENU_ID = "zotlink-item-menu";
	const COLLECTION_MENU_ID = "zotlink-collection-menu";
	const MOVE_SHORTCUT_KEY_ID = "zotlink-move-shortcut-key";
	const PLUGIN_NAME = "ZotLink";
	const DEFAULT_ATTACHMENT_MOVE_ROOT = "D:\\OneDrive\\Zotero";
	const DEFAULT_ATTACHMENT_RENAME_PATTERN = "{author} {year} {title}";

	Zotero.ZotLink = {
		_menuElements: [],
		_shortcutElements: [],
		_shortcutHandlers: new Map(),
		_patchedWindows: new Map(),
		_collectionMenuFallbackHandlers: new Map(),
		_fileIDMapCache: null,
		_attachmentFileIDObserver: null,
		_attachmentFileIDNotifierID: null,
		_pendingAttachmentFileIDItemIDs: new Set(),
		_pendingAttachmentFileIDDiagnostics: false,
		_pendingPreferredPrimaryCollectionIDs: new Map(),
		_pendingRemovedCollectionIDs: new Map(),
		_attachmentFileIDTimer: null,
		_collectionDragHandlers: new Map(),
		_pluginID: PLUGIN_ID,
		_rootURI: null,
		_started: false,

		async startup(data) {
			if (this._started) {
				return;
			}
			this._started = true;
			this._pluginID = data.id || PLUGIN_ID;
			this._rootURI = data.rootURI;
			this.runStartupStep("registerPreferencePane", () => this.registerPreferencePane());
			for (let win of Zotero.getMainWindows()) {
				this.runStartupStep("registerCollectionMenu", () => this.registerCollectionMenu(win));
				this.runStartupStep("registerAttachmentOpenHooks", () => this.registerAttachmentOpenHooks(win));
				this.runStartupStep("registerCollectionDragHooks", () => this.registerCollectionDragHooks(win));
			}
			this.runStartupStep("registerAttachmentFileIDObserver", () => this.registerAttachmentFileIDObserver());
			Zotero.debug("ZotLink started");
		},

		async shutdown() {
			this.unregisterAttachmentFileIDObserver();
			this.unregisterItemMenu();
			for (let win of Zotero.getMainWindows()) {
				this.unregisterCollectionMenu(win);
				this.unregisterAttachmentOpenHooks(win);
				this.unregisterCollectionDragHooks(win);
				this.unregisterWindowShortcuts(win);
			}
			this._started = false;
			Zotero.debug("ZotLink stopped");
		},

		onMainWindowLoad(win) {
			this.runStartupStep("registerCollectionMenu", () => this.registerCollectionMenu(win));
			this.runStartupStep("registerItemMenu", () => this.registerItemMenu(win));
			this.runStartupStep("registerShortcut", () => this.registerShortcut(win));
			this.runStartupStep("registerAttachmentOpenHooks", () => this.registerAttachmentOpenHooks(win));
			this.runStartupStep("registerCollectionDragHooks", () => this.registerCollectionDragHooks(win));
		},

		onMainWindowUnload(win) {
			this.unregisterCollectionMenu(win);
			this.unregisterAttachmentOpenHooks(win);
			this.unregisterCollectionDragHooks(win);
			this.unregisterWindowMenus(win);
			this.unregisterWindowShortcuts(win);
		},

		async runStartupStep(name, callback) {
			try {
				await callback();
			}
			catch (e) {
				Zotero.logError(e);
				Zotero.debug(`ZotLink: ${name} failed`, 1);
			}
		},

		registerAttachmentOpenHooks(win) {
			let pane = win?.ZoteroPane;
			if (!pane || this._patchedWindows.has(win)) {
				return;
			}

			let originals = {};
			if (typeof pane.viewAttachment === "function") {
				originals.viewAttachment = pane.viewAttachment;
				let plugin = this;
				pane.viewAttachment = async function (itemIDs, event, noLocateOnMissing, extraData) {
					await plugin.autoRepairAttachmentsBeforeOpen(itemIDs);
					return originals.viewAttachment.call(this, itemIDs, event, noLocateOnMissing, extraData);
				};
			}

			if (typeof pane.showAttachmentInFilesystem === "function") {
				originals.showAttachmentInFilesystem = pane.showAttachmentInFilesystem;
				let plugin = this;
				pane.showAttachmentInFilesystem = async function (itemID, noLocateOnMissing) {
					await plugin.autoRepairAttachmentsBeforeOpen(itemID);
					return originals.showAttachmentInFilesystem.call(this, itemID, noLocateOnMissing);
				};
			}

			if (Object.keys(originals).length) {
				this._patchedWindows.set(win, originals);
			}
		},

		unregisterAttachmentOpenHooks(win) {
			let pane = win?.ZoteroPane;
			let originals = this._patchedWindows.get(win);
			if (!pane || !originals) {
				return;
			}
			if (originals.viewAttachment) {
				pane.viewAttachment = originals.viewAttachment;
			}
			if (originals.showAttachmentInFilesystem) {
				pane.showAttachmentInFilesystem = originals.showAttachmentInFilesystem;
			}
			this._patchedWindows.delete(win);
		},

		registerCollectionDragHooks(win) {
			let doc = win?.document;
			if (!doc || this._collectionDragHandlers.has(win)) {
				return;
			}

			let snapshot = null;
			let timer = null;
			let dragCompleted = false;
			let captureSnapshot = () => {
				snapshot = this.getSelectedItemCollectionSnapshot(win);
				dragCompleted = false;
			};
			let completeDrag = source => {
				if (dragCompleted) {
					return;
				}
				dragCompleted = true;
				let dragSnapshot = snapshot || this.getSelectedItemCollectionSnapshot(win);
				snapshot = null;
				if (!dragSnapshot.size) {
					return;
				}
				if (timer) {
					win.clearTimeout(timer);
				}
				timer = win.setTimeout(() => {
					timer = null;
					this.checkCollectionDragSnapshot(dragSnapshot, source).catch(e => Zotero.logError(e));
				}, 1500);
			};
			let onDrop = () => {
				if (!snapshot) {
					captureSnapshot();
				}
				completeDrag("drop");
			};
			let onDragEnd = () => completeDrag("dragend");

			doc.addEventListener("dragstart", captureSnapshot, true);
			doc.addEventListener("drop", onDrop, true);
			doc.addEventListener("dragend", onDragEnd, true);

			this._collectionDragHandlers.set(win, {
				captureSnapshot,
				onDrop,
				onDragEnd,
				clearTimer: () => {
					if (timer) {
						win.clearTimeout(timer);
						timer = null;
					}
				}
			});
		},

		unregisterCollectionDragHooks(win) {
			let doc = win?.document;
			let handlers = this._collectionDragHandlers.get(win);
			if (!doc || !handlers) {
				return;
			}
			doc.removeEventListener("dragstart", handlers.captureSnapshot, true);
			doc.removeEventListener("drop", handlers.onDrop, true);
			doc.removeEventListener("dragend", handlers.onDragEnd, true);
			handlers.clearTimer();
			this._collectionDragHandlers.delete(win);
		},

		getSelectedItemCollectionSnapshot(win) {
			let pane = win?.ZoteroPane || Zotero.getActiveZoteroPane?.();
			let selectedItems = pane?.getSelectedItems?.() || [];
			let snapshot = new Map();

			for (let item of selectedItems) {
				let regularItem = null;
				if (item?.isRegularItem?.()) {
					regularItem = item;
				}
				else if (item?.isAttachment?.()) {
					regularItem = item.parentItem;
				}
				if (!regularItem?.id || !regularItem.getCollections) {
					continue;
				}
				snapshot.set(regularItem.id, this.getRegularItemCollectionSignature(regularItem));
			}
			return snapshot;
		},

		async checkCollectionDragSnapshot(snapshot, source) {
			let changedItemIDs = [];
			let unchanged = 0;
			let addedCollections = 0;
			let removedCollections = 0;
			let preferredPrimaryCollectionIDs = new Map();
			let removedCollectionIDs = new Map();

			for (let [itemID, before] of snapshot.entries()) {
				let item = await Zotero.Items.getAsync(itemID);
				if (!item?.isRegularItem?.()) {
					continue;
				}
				let after = this.getRegularItemCollectionSignature(item);
				if (before !== after) {
					changedItemIDs.push(itemID);
					let diff = this.diffCollectionSignatures(before, after);
					addedCollections += diff.added;
					removedCollections += diff.removed;
					if (diff.removed && diff.addedIDs.length) {
						preferredPrimaryCollectionIDs.set(itemID, Number(diff.addedIDs[0]));
					}
					if (diff.removedIDs.length) {
						removedCollectionIDs.set(itemID, diff.removedIDs.map(id => Number(id)));
					}
				}
				else {
					unchanged++;
				}
			}

			if (!changedItemIDs.length) {
				Zotero.debug(`ZotLink: collection drag ended (${source}), no collection changes in ${snapshot.size} items, unchanged ${unchanged}`);
				return;
			}

			this.showStatus(`ZotLink 已捕捉 collection 变化：${changedItemIDs.length} 个条目`, 1800);
			this.scheduleAttachmentFileIDIndexing(changedItemIDs, {
				delay: 0,
				preferredPrimaryCollectionIDs,
				removedCollectionIDs
			});
		},

		diffCollectionSignatures(before, after) {
			let beforeSet = new Set(String(before || "").split("|").filter(Boolean));
			let afterSet = new Set(String(after || "").split("|").filter(Boolean));
			let added = 0;
			let removed = 0;
			let addedIDs = [];
			let removedIDs = [];
			for (let id of afterSet) {
				if (!beforeSet.has(id)) {
					added++;
					addedIDs.push(id);
				}
			}
			for (let id of beforeSet) {
				if (!afterSet.has(id)) {
					removed++;
					removedIDs.push(id);
				}
			}
			return { added, removed, addedIDs, removedIDs };
		},

		async autoRepairAttachmentsBeforeOpen(itemIDs) {
			let ids = Array.isArray(itemIDs) ? itemIDs : [itemIDs];
			for (let itemID of ids) {
				try {
					let item = await Zotero.Items.getAsync(itemID);
					if (item?.isAttachment?.()) {
						await this.repairAttachmentLinkByFileID(item, { silent: true });
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
		},

		registerAttachmentFileIDObserver() {
			if (!Zotero.Notifier || this._attachmentFileIDNotifierID) {
				return;
			}

			this._attachmentFileIDObserver = {
				notify: (event, type, ids, extraData) => {
					let itemIDs = this.getNotifierItemIDs(event, type, ids, extraData);
					this.scheduleAttachmentFileIDIndexing(itemIDs);
				}
			};
			this._attachmentFileIDNotifierID = Zotero.Notifier.registerObserver(
				this._attachmentFileIDObserver,
				["item", "collection", "collection-item"],
				this._pluginID + "-attachment-file-id"
			);
		},

		getNotifierItemIDs(event, type, ids, extraData) {
			if (type === "item" && (event === "add" || event === "modify")) {
				return Array.isArray(ids) ? ids : [ids];
			}

			if (type !== "collection-item" || !["add", "modify", "delete", "remove"].includes(event)) {
				return [];
			}

			let itemIDs = new Set();
			for (let id of Array.isArray(ids) ? ids : [ids]) {
				this.addPossibleItemID(itemIDs, id);
				let data = extraData?.[id];
				if (data) {
					this.addPossibleItemID(itemIDs, data.itemID);
					this.addPossibleItemID(itemIDs, data.itemId);
					this.addPossibleItemID(itemIDs, data.id);
					this.addPossibleItemID(itemIDs, data.key);
				}
				if (typeof id === "string") {
					for (let part of id.split(/[-_:/|]/)) {
						this.addPossibleItemID(itemIDs, part);
					}
				}
			}

			if (event !== "delete" && event !== "remove") {
				for (let item of Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() || []) {
					if (item?.isRegularItem?.() || item?.isAttachment?.()) {
						this.addPossibleItemID(itemIDs, item.id);
					}
				}
			}
			return Array.from(itemIDs);
		},

		addPossibleItemID(target, value) {
			let id = Number(value);
			if (Number.isInteger(id) && id > 0) {
				target.add(id);
			}
		},

		getAttachmentCollectionSignature(attachment) {
			let parent = attachment?.parentItem;
			if (!parent?.getCollections) {
				return "";
			}
			return this.getRegularItemCollectionSignature(parent);
		},

		getRegularItemCollectionSignature(item) {
			if (!item?.getCollections) {
				return "";
			}
			return item.getCollections()
				.map(id => Number(id))
				.filter(id => Number.isInteger(id) && id > 0)
				.sort((a, b) => a - b)
				.join("|");
		},

		unregisterAttachmentFileIDObserver() {
			if (this._attachmentFileIDTimer) {
				clearTimeout(this._attachmentFileIDTimer);
				this._attachmentFileIDTimer = null;
			}
			this._pendingAttachmentFileIDItemIDs.clear();
			this._pendingAttachmentFileIDDiagnostics = false;
			this._pendingPreferredPrimaryCollectionIDs.clear();
			this._pendingRemovedCollectionIDs.clear();
			if (this._attachmentFileIDNotifierID && Zotero.Notifier) {
				Zotero.Notifier.unregisterObserver(this._attachmentFileIDNotifierID);
			}
			this._attachmentFileIDNotifierID = null;
			this._attachmentFileIDObserver = null;
		},

		scheduleAttachmentFileIDIndexing(itemIDs, options = {}) {
			if (options.diagnostics) {
				this._pendingAttachmentFileIDDiagnostics = true;
			}
			for (let [itemID, collectionID] of options.preferredPrimaryCollectionIDs || []) {
				itemID = Number(itemID);
				collectionID = Number(collectionID);
				if (Number.isInteger(itemID) && itemID > 0 && Number.isInteger(collectionID) && collectionID > 0) {
					this._pendingPreferredPrimaryCollectionIDs.set(itemID, collectionID);
				}
			}
			for (let [itemID, collectionIDs] of options.removedCollectionIDs || []) {
				itemID = Number(itemID);
				if (!Number.isInteger(itemID) || itemID <= 0) {
					continue;
				}
				let ids = (collectionIDs || [])
					.map(id => Number(id))
					.filter(id => Number.isInteger(id) && id > 0);
				if (ids.length) {
					this._pendingRemovedCollectionIDs.set(itemID, ids);
				}
			}
			let ids = Array.isArray(itemIDs) ? itemIDs : [itemIDs];
			for (let id of ids) {
				if (id) {
					this._pendingAttachmentFileIDItemIDs.add(id);
				}
			}
			if (!this._pendingAttachmentFileIDItemIDs.size) {
				return;
			}

			if (this._attachmentFileIDTimer) {
				clearTimeout(this._attachmentFileIDTimer);
			}
			this._attachmentFileIDTimer = setTimeout(() => {
				this._attachmentFileIDTimer = null;
				this.flushAttachmentFileIDIndexing().catch(e => Zotero.logError(e));
			}, Number.isFinite(options.delay) ? Math.max(0, options.delay) : 5000);
		},

		async flushAttachmentFileIDIndexing() {
			let ids = Array.from(this._pendingAttachmentFileIDItemIDs);
			let diagnosticsEnabled = this._pendingAttachmentFileIDDiagnostics;
			let preferredPrimaryCollectionIDs = new Map(this._pendingPreferredPrimaryCollectionIDs);
			let removedCollectionIDs = new Map(this._pendingRemovedCollectionIDs);
			let diagnosticLines = [];
			this._pendingAttachmentFileIDItemIDs.clear();
			this._pendingAttachmentFileIDDiagnostics = false;
			this._pendingPreferredPrimaryCollectionIDs.clear();
			this._pendingRemovedCollectionIDs.clear();
			if (!ids.length) {
				return;
			}

			let index = this.getAttachmentFileIndex();
			let attachments = await this.getFileAttachmentsFromChangedItems(ids);
			if (!attachments.length) {
				if (diagnosticsEnabled) {
					this.showHardlinkDiagnostic([
						"已触发指定条目的 collection 变化同步。",
						`索引记录数：${Object.keys(index).length}`,
						`变化条目数：${ids.length}`,
						"结果：这些条目下没有找到可同步的文件附件。"
					]);
				}
				return;
			}

			let changed = false;
			let synced = 0;
			let skipped = 0;
			for (let attachment of attachments) {
				try {
					let moveResult = await this.autoMoveStoredAttachmentToCollectionPath(attachment);
					if (moveResult.ok) {
						changed = true;
					}
					if (!(await this.isAttachmentFileIDIndexCurrent(attachment, index))) {
						let result = await this.indexAttachmentFileID(attachment, {
							quiet: true,
							index,
							save: false
						});
						changed = changed || Boolean(result.ok);
					}
					let syncResult = await this.syncAttachmentMirrors(attachment, {
						index,
						save: false,
						diagnostics: diagnosticsEnabled ? [] : null,
						preferredCollectionID: preferredPrimaryCollectionIDs.get(attachment.parentItem?.id),
						removedCollectionIDs: removedCollectionIDs.get(attachment.parentItem?.id) || []
					});
					changed = changed || Boolean(syncResult.changed);
					if (this.getBoolPref("autoRenameAttachmentsEnabled", false) && await this.isPrimaryPDFAttachment(attachment)) {
						let renameResult = await this.renameAttachmentByRule(attachment, { silent: true });
						if (renameResult.ok && renameResult.changed) {
							changed = true;
							await this.indexAttachmentFileID(attachment, {
								quiet: true,
								index,
								save: false
							});
							syncResult = await this.syncAttachmentMirrors(attachment, {
								index,
								save: false,
								diagnostics: diagnosticsEnabled ? [] : null,
								preferredCollectionID: preferredPrimaryCollectionIDs.get(attachment.parentItem?.id),
								removedCollectionIDs: removedCollectionIDs.get(attachment.parentItem?.id) || []
							});
							changed = changed || Boolean(syncResult.changed);
						}
					}
					await this.writeAttachmentPDFDOIMetadata(attachment, { silent: true });
					synced++;
					if (diagnosticsEnabled) {
						diagnosticLines.push(this.formatMirrorDiagnosticLine(attachment, syncResult));
					}
				}
				catch (e) {
					Zotero.logError(e);
					skipped++;
					if (diagnosticsEnabled) {
						diagnosticLines.push(`${this.getItemDisplayName(attachment)}：异常：${e.message || e}`);
					}
				}
			}

			if (changed) {
				this.setAttachmentFileIndex(index);
			}
			if (diagnosticsEnabled) {
				this.showHardlinkDiagnostic([
					"已触发指定条目的 collection 变化同步。",
					`索引记录数：${Object.keys(index).length}`,
					`变化条目数：${ids.length}`,
					`本次检查附件数：${attachments.length}`,
					`完成：${synced}；异常：${skipped}`,
					`索引是否变化：${changed ? "是" : "否"}`,
					"",
					...diagnosticLines
				]);
			}
		},

		async getFileAttachmentsFromChangedItems(itemIDs) {
			let attachments = new Map();
			for (let itemID of itemIDs) {
				try {
					let item = await Zotero.Items.getAsync(itemID);
					if (!item) {
						continue;
					}
					if (item.isFileAttachment?.()) {
						attachments.set(item.id, item);
						continue;
					}
					if (!item.isRegularItem?.()) {
						continue;
					}
					for (let attachmentID of item.getAttachments()) {
						let attachment = await Zotero.Items.getAsync(attachmentID);
						if (attachment?.isFileAttachment?.()) {
							attachments.set(attachment.id, attachment);
						}
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			return Array.from(attachments.values());
		},

		async getIndexedFileAttachments(index, extraItemIDs = []) {
			let attachments = new Map();
			for (let attachment of await this.getFileAttachmentsFromChangedItems(extraItemIDs)) {
				attachments.set(attachment.id, attachment);
			}
			for (let record of Object.values(index || {})) {
				try {
					let attachment = await this.getIndexedAttachment(record);
					if (attachment?.isFileAttachment?.()) {
						attachments.set(attachment.id, attachment);
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			return Array.from(attachments.values());
		},

		async getIndexedAttachment(record) {
			if (!record || typeof record !== "object") {
				return null;
			}
			if (record.itemID) {
				let item = await Zotero.Items.getAsync(record.itemID);
				if (item) {
					return item;
				}
			}
			if (record.key && Zotero.Items.getByLibraryAndKey) {
				return Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, record.key);
			}
			return null;
		},

		async isAttachmentFileIDIndexCurrent(attachment, index) {
			let record = this.normalizeAttachmentIndexRecord(attachment, index[attachment.key]);
			if (!record?.fileID) {
				return false;
			}
			let path = attachment.getFilePath();
			return Boolean(path && this.pathsEqual(path, record.primaryPath) && await IOUtils.exists(path));
		},

		async autoMoveStoredAttachmentToCollectionPath(attachment) {
			if (!attachment?.isFileAttachment?.()) {
				return { ok: false, reason: "不是文件附件" };
			}
			if (attachment.libraryID !== Zotero.Libraries.userLibraryID) {
				return { ok: false, reason: "非个人库附件" };
			}

			let sourcePath = attachment.getFilePath();
			if (!sourcePath || !(await IOUtils.exists(sourcePath))) {
				return { ok: false, reason: "源文件不存在" };
			}
			if (!this.isStoredAttachmentPath(sourcePath)) {
				return { ok: false, reason: "不是 storage 复制附件" };
			}

			let root = this.getAttachmentMoveRoot();
			if (!root) {
				return { ok: false, reason: "未设置附件移动顶层路径" };
			}

			let collectionPath = this.getCollectionPathForAttachment(attachment, null);
			if (!collectionPath.length) {
				return { ok: false, reason: "没有集合路径" };
			}

			let destinationDir = PathUtils.join(root, ...collectionPath);
			let result = await this.moveAttachmentFileInPlace(attachment, destinationDir);
			if (!result.ok) {
				return result;
			}

			await this.removeStorageDirectoryForMovedAttachment(sourcePath);
			return { ok: true };
		},

		isStoredAttachmentPath(path) {
			let storageRoot = this.getZoteroStoragePath();
			if (!storageRoot || !path) {
				return false;
			}
			let normalizedRoot = this.normalizePathForCompare(storageRoot);
			let normalizedPath = this.normalizePathForCompare(path);
			return normalizedPath.startsWith(normalizedRoot + "/");
		},

		getZoteroStoragePath() {
			let dataDir = Zotero.DataDirectory?.dir || Zotero.DataDirectory?.getDatabaseDirectory?.();
			return dataDir ? PathUtils.join(dataDir, "storage") : "";
		},

		normalizePathForCompare(path) {
			return String(path || "").replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
		},

		async removeStorageDirectoryForMovedAttachment(sourcePath) {
			let storageRoot = this.getZoteroStoragePath();
			let storageDir = this.getParentPath(sourcePath);
			if (!storageRoot || !storageDir) {
				return;
			}

			let normalizedRoot = this.normalizePathForCompare(storageRoot);
			let normalizedDir = this.normalizePathForCompare(storageDir);
			if (!normalizedDir.startsWith(normalizedRoot + "/") || normalizedDir === normalizedRoot) {
				return;
			}

			try {
				await IOUtils.remove(storageDir, { recursive: true });
				Zotero.debug(`ZotLink removed storage directory: ${storageDir}`);
			}
			catch (e) {
				Zotero.logError(e);
				Zotero.debug(`ZotLink: failed to remove storage directory ${storageDir}`, 1);
			}
		},

		getPref(key, fallback = "") {
			let pref = PREF_PREFIX + key;
			let value = Zotero.Prefs.get(pref);
			if (value === undefined || value === null || value === "") {
				value = Zotero.Prefs.get(pref, true);
			}
			if (value === undefined || value === null || value === "") {
				return fallback;
			}
			return value;
		},

		getBoolPref(key, fallback = false) {
			let value = this.getPref(key, fallback);
			if (typeof value === "boolean") {
				return value;
			}
			if (typeof value === "number") {
				return value !== 0;
			}
			if (typeof value === "string") {
				return /^(true|1|yes|on)$/i.test(value.trim());
			}
			return Boolean(value);
		},

		setPref(key, value) {
			let pref = PREF_PREFIX + key;
			Zotero.Prefs.set(pref, value);
			try {
				Zotero.Prefs.set(pref, value, true);
			}
			catch (e) {
				// Older Zotero builds may not accept the global flag on set().
			}
		},

		async reloadSettings(options = {}) {
			for (let win of Zotero.getMainWindows()) {
				this.unregisterWindowMenus(win);
				this.registerItemMenu(win);
				this.unregisterWindowShortcuts(win);
				this.registerShortcut(win);
			}
			if (!options.silent) {
				this.showStatus("ZotLink 设置已重新加载");
			}
		},

		async handlePreferenceAction(action, button) {
			let now = Date.now();
			if (this._lastPreferenceAction
				&& this._lastPreferenceAction.action === action
				&& now - this._lastPreferenceAction.time < 250) {
				return;
			}
			this._lastPreferenceAction = { action, time: now };

			try {
				let doc = button?.ownerDocument || Zotero.getMainWindow()?.document;
				if (action === "saveAttachmentSettings") {
					let root = doc.getElementById("zotlink-move-root")?.value?.trim() || "";
					let shortcutInput = doc.getElementById("zotlink-move-shortcut");
					let shortcut = this.normalizeShortcutText(shortcutInput?.value?.trim() || "");
					let autoRenameEnabled = Boolean(doc.getElementById("zotlink-auto-rename-enabled")?.checked);
					let renamePattern = doc.getElementById("zotlink-rename-pattern")?.value?.trim() || DEFAULT_ATTACHMENT_RENAME_PATTERN;
					if (shortcutInput) {
						shortcutInput.value = shortcut;
					}
					if (shortcut && !this.parseShortcut(shortcut)) {
						this.showPreferenceAlert("快捷键无效", "请使用类似 Ctrl+Alt+M 的组合键，至少包含 Ctrl、Alt、Shift 或 Meta 中的一个修饰键。");
						return;
					}
					let conflict = shortcut ? this.findShortcutConflict(shortcut) : null;
					if (conflict && !this.confirmPreferenceAction("快捷键可能冲突", `快捷键 ${shortcut} 可能已被 Zotero 使用：${conflict}。\n\n仍然保存吗？`)) {
						return;
					}
					this.setPref("attachmentMoveRoot", root);
					this.setPref("attachmentMoveShortcut", shortcut);
					this.setPref("autoRenameAttachmentsEnabled", autoRenameEnabled);
					this.setPref("attachmentRenamePattern", renamePattern);
					this.setInputValue(shortcutInput, shortcut);
					this.updateCurrentShortcutLabel(doc, shortcut);
					await this.reloadSettings({ silent: true });
					this.flashPreferenceButton(button, shortcut ? `已保存：${shortcut}` : "已保存：未设置");
					return;
				}

				if (action === "indexAllAttachments") {
					let originalLabel = button?.getAttribute?.("label") || "初始化全库附件机内码";
					if (button) {
						button.disabled = true;
						button.setAttribute("label", "正在初始化...");
					}
					try {
						await this.indexAllLibraryAttachmentFileIDs({
							onProgress: ({ processed, total }) => {
								button?.setAttribute?.("label", `正在初始化 ${processed}/${total}`);
							}
						});
					}
					finally {
						if (button) {
							button.disabled = false;
							button.setAttribute("label", originalLabel);
						}
					}
					return;
				}

				if (action === "writeAllPDFDOIMetadata") {
					let originalLabel = button?.getAttribute?.("label") || "写入全库 PDF DOI 元数据";
					if (button) {
						button.disabled = true;
						button.setAttribute("label", "正在写入...");
					}
					try {
						await this.writeAllLibraryPDFDOIMetadata({
							useProgressWindow: false,
							softReport: true,
							onProgress: ({ processed, total }) => {
								button?.setAttribute?.("label", `正在写入 ${processed}/${total}`);
							}
						});
					}
					finally {
						if (button) {
							button.disabled = false;
							button.setAttribute("label", originalLabel);
						}
					}
					return;
				}

				if (action === "showLastMoveReport") {
					this.showMoveReport(this.getPref("lastMoveReport", "还没有移动记录。"));
					return;
				}

				throw new Error(`未知设置操作：${action}`);
			}
			catch (e) {
				Zotero.logError(e);
				this.showPreferenceAlert("设置按钮错误", this.errorToText(e) || String(e));
			}
		},

		showPreferenceAlert(title, message) {
			if (LFServices?.prompt?.alert) {
				LFServices.prompt.alert(Zotero.getMainWindow(), title, message);
				return;
			}
			alert(message);
		},

		showAlert(title, message) {
			this.showPreferenceAlert(title, message);
		},

		flashPreferenceButton(button, label, duration = 1600) {
			if (!button) {
				return;
			}
			let originalLabel = button.getAttribute("label");
			button.setAttribute("label", label);
			button.disabled = true;
			button.ownerGlobal.setTimeout(() => {
				button.disabled = false;
				button.setAttribute("label", originalLabel);
			}, duration);
		},

		setInputValue(input, value) {
			if (!input) {
				return;
			}
			value = String(value || "");
			input.value = value;
			input.setAttribute("value", value);
			if (input.inputField) {
				input.inputField.value = value;
			}
		},

		updateCurrentShortcutLabel(doc, shortcut) {
			let label = doc.getElementById("zotlink-current-shortcut");
			if (!label) {
				return;
			}
			label.setAttribute("value", shortcut ? `当前：${shortcut}` : "当前：未设置");
		},

		confirmPreferenceAction(title, message) {
			if (LFServices?.prompt?.confirm) {
				return LFServices.prompt.confirm(Zotero.getMainWindow(), title, message);
			}
			return confirm(message);
		},

		captureShortcutInput(event, input) {
			let shortcut = this.shortcutFromKeyboardEvent(event);
			if (!shortcut) {
				if (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape") {
					this.setInputValue(input, "");
					this.updateCurrentShortcutLabel(input.ownerDocument, "");
					event.preventDefault();
				}
				return;
			}
			this.setInputValue(input, shortcut);
			this.updateCurrentShortcutLabel(input.ownerDocument, shortcut);
			event.preventDefault();
			event.stopPropagation();
		},

		shortcutFromKeyboardEvent(event) {
			let key = event.key || "";
			if (["Control", "Shift", "Alt", "Meta", "OS"].includes(key)) {
				return "";
			}

			let modifiers = [];
			if (event.ctrlKey) {
				modifiers.push("Ctrl");
			}
			if (event.altKey) {
				modifiers.push("Alt");
			}
			if (event.shiftKey) {
				modifiers.push("Shift");
			}
			if (event.metaKey) {
				modifiers.push("Meta");
			}
			if (!modifiers.length) {
				return "";
			}

			let normalizedKey = this.displayKeyFromEvent(event);
			if (!normalizedKey) {
				return "";
			}
			return [...modifiers, normalizedKey].join("+");
		},

		displayKeyFromEvent(event) {
			let key = event.key || "";
			if (key.length === 1) {
				return key.toUpperCase();
			}
			let code = event.code || "";
			if (/^Key[A-Z]$/.test(code)) {
				return code.slice(3);
			}
			if (/^Digit[0-9]$/.test(code)) {
				return code.slice(5);
			}
			let map = {
				ArrowUp: "UP",
				ArrowDown: "DOWN",
				ArrowLeft: "LEFT",
				ArrowRight: "RIGHT",
				PageUp: "PAGE_UP",
				PageDown: "PAGE_DOWN",
				Home: "HOME",
				End: "END",
				Insert: "INSERT",
				Delete: "DELETE",
				Backspace: "BACK_SPACE",
				Enter: "RETURN",
				Escape: "ESCAPE",
				" ": "SPACE"
			};
			return map[key] || (/^F([1-9]|1[0-9]|2[0-4])$/.test(key) ? key : "");
		},

		normalizeShortcutText(shortcut) {
			let parsed = this.parseShortcut(shortcut);
			if (!parsed) {
				return String(shortcut || "").trim();
			}
			let modifierLabels = parsed.modifiers.map(modifier => ({
				accel: "Ctrl",
				alt: "Alt",
				shift: "Shift",
				meta: "Meta"
			}[modifier] || modifier));
			let key = parsed.key.replace(/^VK_/, "");
			return [...modifierLabels, key].join("+");
		},

		registerPreferencePane() {
			if (!Zotero.PreferencePanes?.register || !this._rootURI) {
				return;
			}
			Zotero.PreferencePanes.register({
				pluginID: this._pluginID,
				src: this._rootURI + "content/preferences.xhtml",
				label: PLUGIN_NAME
			});
		},

		initializePreferencePane(doc) {
			try {
				let rootInput = doc.getElementById("zotlink-move-root");
				this.setInputValue(rootInput, this.getPref("attachmentMoveRoot", DEFAULT_ATTACHMENT_MOVE_ROOT));
				let shortcutInput = doc.getElementById("zotlink-move-shortcut");
				let shortcut = this.getPref("attachmentMoveShortcut", "");
				this.setInputValue(shortcutInput, shortcut);
				this.updateCurrentShortcutLabel(doc, shortcut);
				let autoRenameInput = doc.getElementById("zotlink-auto-rename-enabled");
				if (autoRenameInput) {
					autoRenameInput.checked = this.getBoolPref("autoRenameAttachmentsEnabled", false);
				}
				this.setInputValue(doc.getElementById("zotlink-rename-pattern"), this.getPref("attachmentRenamePattern", DEFAULT_ATTACHMENT_RENAME_PATTERN));
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		registerItemMenu(win) {
			let doc = win.document;
			let menu = doc.getElementById("zotero-itemmenu");
			if (!menu || doc.getElementById(ITEM_MENU_ID)) {
				return;
			}

			let root = doc.createXULElement("menu");
			root.id = ITEM_MENU_ID;
			root.setAttribute("label", PLUGIN_NAME);

			let popup = doc.createXULElement("menupopup");
			root.appendChild(popup);

			let moveAttachmentsItem = doc.createXULElement("menuitem");
			moveAttachmentsItem.setAttribute("label", "移动附件到集合目录");
			moveAttachmentsItem.addEventListener("command", () => this.moveSelectedAttachmentsToCollectionPath());
			popup.appendChild(moveAttachmentsItem);

			let indexAttachmentsItem = doc.createXULElement("menuitem");
			indexAttachmentsItem.setAttribute("label", "记录选中附件机内码");
			indexAttachmentsItem.addEventListener("command", () => this.indexSelectedAttachmentFileIDs());
			popup.appendChild(indexAttachmentsItem);

			let writePDFDOIMetadataItem = doc.createXULElement("menuitem");
			writePDFDOIMetadataItem.setAttribute("label", "写入 PDF DOI 元数据");
			writePDFDOIMetadataItem.addEventListener("command", () => this.writeSelectedPDFDOIMetadata());
			popup.appendChild(writePDFDOIMetadataItem);

			let renamePrimaryPDFItem = doc.createXULElement("menuitem");
			renamePrimaryPDFItem.setAttribute("label", "按规则重命名主 PDF");
			renamePrimaryPDFItem.addEventListener("command", () => this.renameSelectedPrimaryPDFsByRule());
			popup.appendChild(renamePrimaryPDFItem);

			let repairAttachmentsItem = doc.createXULElement("menuitem");
			repairAttachmentsItem.setAttribute("label", "按机内码修复附件链接");
			repairAttachmentsItem.addEventListener("command", () => this.repairSelectedAttachmentLinksByFileID());
			popup.appendChild(repairAttachmentsItem);

			let reloadItem = doc.createXULElement("menuitem");
			reloadItem.setAttribute("label", "重新加载 ZotLink 设置");
			reloadItem.addEventListener("command", () => this.reloadSettings());
			popup.appendChild(reloadItem);

			menu.appendChild(root);
			this._menuElements.push(root);
		},

		registerCollectionMenu(win) {
			let doc = win.document;
			if (doc.getElementById(COLLECTION_MENU_ID)) {
				return;
			}
			let menu = this.getCollectionContextMenu(doc);
			if (!menu) {
				Zotero.debug("ZotLink: collection context menu not found", 1);
				this.registerCollectionMenuFallback(win);
				return;
			}

			this.appendCollectionMenu(doc, menu);
		},

		appendCollectionMenu(doc, menu) {
			if (!doc || !menu || doc.getElementById(COLLECTION_MENU_ID)) {
				return false;
			}

			let root = doc.createXULElement("menu");
			root.id = COLLECTION_MENU_ID;
			root.setAttribute("label", PLUGIN_NAME);

			let popup = doc.createXULElement("menupopup");
			root.appendChild(popup);

			let importPDFsItem = doc.createXULElement("menuitem");
			importPDFsItem.setAttribute("label", "仅导入当前文件夹 PDF");
			importPDFsItem.addEventListener("command", () => this.importPDFsFromSelectedCollectionFolder({ recursive: false }));
			popup.appendChild(importPDFsItem);

			let importPDFsRecursiveItem = doc.createXULElement("menuitem");
			importPDFsRecursiveItem.setAttribute("label", "导入当前文件夹及子文件夹 PDF");
			importPDFsRecursiveItem.addEventListener("command", () => this.importPDFsFromSelectedCollectionFolder({ recursive: true }));
			popup.appendChild(importPDFsRecursiveItem);

			menu.appendChild(root);
			this._menuElements.push(root);
			return true;
		},

		getCollectionContextMenu(doc) {
			for (let id of [
				"zotero-collectionmenu",
				"zotero-collection-menu",
				"zotero-collection-context-menu",
				"collectionsContextMenu",
				"collection-menu"
			]) {
				let menu = doc.getElementById(id);
				if (menu) {
					return menu;
				}
			}
			for (let menu of doc.querySelectorAll?.("menupopup,popup") || []) {
				if (this.isLikelyCollectionContextMenu(menu)) {
					return menu;
				}
			}
			return null;
		},

		registerCollectionMenuFallback(win) {
			let doc = win?.document;
			if (!doc || this._collectionMenuFallbackHandlers.has(win)) {
				return;
			}

			let handler = event => {
				let menu = event.target;
				if (!menu || doc.getElementById(COLLECTION_MENU_ID)) {
					return;
				}
				if (!this.isLikelyCollectionContextMenu(menu)) {
					return;
				}
				this.appendCollectionMenu(doc, menu);
			};
			doc.addEventListener("popupshowing", handler, true);
			this._collectionMenuFallbackHandlers.set(win, handler);
		},

		unregisterCollectionMenuFallback(win) {
			let doc = win?.document;
			let handler = this._collectionMenuFallbackHandlers.get(win);
			if (doc && handler) {
				doc.removeEventListener("popupshowing", handler, true);
			}
			this._collectionMenuFallbackHandlers.delete(win);
		},

		isLikelyCollectionContextMenu(menu) {
			let id = String(menu?.id || "").toLowerCase();
			let className = String(menu?.className || "").toLowerCase();
			let context = `${id} ${className}`;
			if (/collection/.test(context) && /menu|popup|context/.test(context)) {
				return true;
			}
			let trigger = String(menu?.triggerNode?.id || menu?.triggerNode?.className || "").toLowerCase();
			return /collection/.test(trigger);
		},

		unregisterCollectionMenu(win) {
			let doc = win?.document;
			if (!doc) {
				return;
			}
			doc.getElementById(COLLECTION_MENU_ID)?.remove();
			this.unregisterCollectionMenuFallback(win);
			this._menuElements = this._menuElements.filter(element => element.ownerDocument !== doc);
		},

		unregisterItemMenu() {
			for (let element of this._menuElements) {
				element.remove();
			}
			this._menuElements = [];
		},

		unregisterWindowMenus(win) {
			let doc = win.document;
			for (let id of [ITEM_MENU_ID, COLLECTION_MENU_ID]) {
				doc.getElementById(id)?.remove();
			}
			this.unregisterCollectionMenuFallback(win);
			this._menuElements = this._menuElements.filter(element => element.ownerDocument !== doc);
		},

		registerShortcut(win) {
			let shortcut = String(this.getPref("attachmentMoveShortcut", "") || "").trim();
			if (!shortcut) {
				return;
			}

			let parsed = this.parseShortcut(shortcut);
			if (!parsed) {
				Zotero.debug(`ZotLink: invalid shortcut ${shortcut}`, 1);
				return;
			}

			let doc = win.document;
			this.unregisterWindowShortcuts(win);

			let keyset = doc.getElementById("mainKeyset") || doc.documentElement;
			let key = doc.createXULElement("key");
			key.id = MOVE_SHORTCUT_KEY_ID;
			key.setAttribute(parsed.key.length === 1 ? "key" : "keycode", parsed.key);
			key.setAttribute("modifiers", parsed.modifiers.join(","));
			key.addEventListener("command", () => this.moveSelectedAttachmentsToCollectionPath());
			keyset.appendChild(key);
			this._shortcutElements.push(key);

			let handler = event => {
				if (this.keyboardEventMatchesShortcut(event, parsed)) {
					event.preventDefault();
					event.stopPropagation();
					this.moveSelectedAttachmentsToCollectionPath();
				}
			};
			doc.addEventListener("keydown", handler, true);
			this._shortcutHandlers.set(win, handler);
		},

		findShortcutConflict(shortcut) {
			let parsed = this.parseShortcut(shortcut);
			if (!parsed) {
				return "";
			}
			let target = this.shortcutSignature(parsed);
			for (let win of Zotero.getMainWindows()) {
				let doc = win.document;
				for (let keyElement of doc.querySelectorAll("key")) {
					if (keyElement.id === MOVE_SHORTCUT_KEY_ID) {
						continue;
					}
					let signature = this.shortcutSignature({
						key: keyElement.getAttribute("keycode") || keyElement.getAttribute("key") || "",
						modifiers: String(keyElement.getAttribute("modifiers") || "")
							.split(",")
							.map(modifier => modifier.trim())
							.filter(Boolean)
					});
					if (signature && signature === target) {
						return keyElement.getAttribute("label")
							|| keyElement.getAttribute("command")
							|| keyElement.id
							|| "已有快捷键";
					}
				}
			}
			return "";
		},

		shortcutSignature(parsed) {
			if (!parsed?.key || !parsed?.modifiers?.length) {
				return "";
			}
			let modifiers = parsed.modifiers
				.map(modifier => modifier === "control" || modifier === "ctrl" ? "accel" : modifier)
				.sort()
				.join("+");
			let key = String(parsed.key).toUpperCase();
			if (key.length === 1) {
				key = key.toUpperCase();
			}
			return `${modifiers}+${key}`;
		},

		unregisterWindowShortcuts(win) {
			let doc = win.document;
			doc.getElementById(MOVE_SHORTCUT_KEY_ID)?.remove();
			let handler = this._shortcutHandlers.get(win);
			if (handler) {
				doc.removeEventListener("keydown", handler, true);
				this._shortcutHandlers.delete(win);
			}
			this._shortcutElements = this._shortcutElements.filter(element => element.ownerDocument !== doc);
		},

		keyboardEventMatchesShortcut(event, parsed) {
			if (!parsed) {
				return false;
			}
			let eventShortcut = this.shortcutFromKeyboardEvent(event);
			let eventParsed = this.parseShortcut(eventShortcut);
			return this.shortcutSignature(eventParsed) === this.shortcutSignature(parsed);
		},

		parseShortcut(shortcut) {
			let parts = shortcut.split("+").map(part => part.trim()).filter(Boolean);
			if (parts.length < 2) {
				return null;
			}

			let key = parts.pop();
			let modifiers = [];
			for (let part of parts) {
				let normalized = part.toLowerCase();
				if (["ctrl", "control", "accel"].includes(normalized)) {
					modifiers.push("accel");
				}
				else if (["shift"].includes(normalized)) {
					modifiers.push("shift");
				}
				else if (["alt", "option"].includes(normalized)) {
					modifiers.push("alt");
				}
				else if (["meta", "command", "cmd"].includes(normalized)) {
					modifiers.push("meta");
				}
			}

			if (!modifiers.length || !key) {
				return null;
			}

			let normalizedKey = key.length === 1 ? key.toUpperCase() : key.toUpperCase();
			if (!/^VK_/.test(normalizedKey) && normalizedKey.length > 1) {
				normalizedKey = "VK_" + normalizedKey;
			}
			return {
				key: normalizedKey,
				modifiers
			};
		},

		getSelectedAttachments() {
			let pane = Zotero.getActiveZoteroPane();
			let selectedItems = pane.getSelectedItems();
			let attachments = new Map();

			for (let item of selectedItems) {
				if (item.isAttachment?.()) {
					attachments.set(item.id, item);
					continue;
				}

				if (!item.isRegularItem?.()) {
					continue;
				}

				for (let attachmentID of item.getAttachments()) {
					let attachment = Zotero.Items.get(attachmentID);
					if (attachment?.isFileAttachment?.()) {
						attachments.set(attachment.id, attachment);
					}
				}
			}

			return Array.from(attachments.values());
		},

		async getSelectedPrimaryPDFAttachments() {
			let pane = Zotero.getActiveZoteroPane();
			let selectedItems = pane.getSelectedItems();
			let attachments = new Map();

			for (let item of selectedItems) {
				if (item.isAttachment?.()) {
					if (item.isFileAttachment?.() && this.isPDFFilePath(item.getFilePath?.(), item)) {
						attachments.set(item.id, item);
					}
					continue;
				}

				if (!item.isRegularItem?.()) {
					continue;
				}

				let attachment = await this.getPrimaryPDFAttachmentForItem(item);
				if (attachment) {
					attachments.set(attachment.id, attachment);
				}
			}

			return Array.from(attachments.values());
		},

		async getPrimaryPDFAttachmentForItem(item) {
			if (!item?.isRegularItem?.()) {
				return null;
			}

			for (let method of ["getBestAttachment", "getBestAttachmentAsync"]) {
				if (typeof item[method] === "function") {
					try {
						let result = await item[method]();
						let attachment = typeof result === "number" ? await Zotero.Items.getAsync(result) : result;
						if (attachment?.isFileAttachment?.() && this.isPDFFilePath(attachment.getFilePath?.(), attachment)) {
							return attachment;
						}
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
			}

			let attachmentIDs = item.getAttachments?.() || [];
			for (let attachmentID of attachmentIDs) {
				let attachment = await Zotero.Items.getAsync(attachmentID);
				if (attachment?.isFileAttachment?.() && this.isPDFFilePath(attachment.getFilePath?.(), attachment)) {
					return attachment;
				}
			}
			return null;
		},

		async isPrimaryPDFAttachment(attachment) {
			if (!attachment?.isFileAttachment?.() || !this.isPDFFilePath(attachment.getFilePath?.(), attachment)) {
				return false;
			}
			let parent = attachment.parentItem;
			if (!parent?.isRegularItem?.()) {
				return false;
			}
			let primaryAttachment = await this.getPrimaryPDFAttachmentForItem(parent);
			return Boolean(primaryAttachment && Number(primaryAttachment.id) === Number(attachment.id));
		},

		async importPDFsFromSelectedCollectionFolder(options = {}) {
			let recursive = !!options.recursive;
			let pane = Zotero.getActiveZoteroPane();
			let collectionID = this.getSelectedCollectionID(pane);
			if (!collectionID) {
				this.showSoftReport("请先在左侧选择一个 collection。");
				return;
			}

			let root = this.getAttachmentMoveRoot();
			if (!root) {
				root = this.promptForAttachmentMoveRoot();
				if (!root) {
					this.showSoftReport("请先在设置中填写附件移动顶层路径");
					return;
				}
			}

			let collectionPath = this.getCollectionPathByID(collectionID);
			if (!collectionPath.length) {
				this.showSoftReport("无法解析当前 collection 的文件夹路径。");
				return;
			}

			let folderPath = PathUtils.join(root, ...collectionPath);
			if (!(await IOUtils.exists(folderPath))) {
				this.showSoftReport(`Collection 对应文件夹不存在：${folderPath}`, 8000);
				return;
			}

			let pdfEntries = recursive
				? await this.getPDFImportEntriesRecursive(folderPath, collectionID)
				: await this.getPDFImportEntriesShallow(folderPath, collectionID);
			let pdfs = pdfEntries.map(entry => entry.path);
			if (!pdfs.length) {
				this.showSoftReport(`未在文件夹中找到 PDF：${folderPath}`, 8000);
				return;
			}

			let existingDOICache = new Map();
			let imported = 0;
			let skipped = 0;
			let reasons = new Map();
			let index = this.getAttachmentFileIndex();
			let headline = recursive ? "正在递归导入 Collection 文件夹 PDF" : "正在从当前 Collection 文件夹导入 PDF";
			let progressWindow = this.createProgressWindow(headline, `已处理 0 / ${pdfs.length}`);

			for (let i = 0; i < pdfEntries.length; i++) {
				let entry = pdfEntries[i];
				let pdfPath = entry.path;
				let targetCollectionID = entry.collectionID || collectionID;
				try {
					let doi = await this.extractDOIFromPDFMetadata(pdfPath);
					if (!doi) {
						skipped++;
						this.countReason(reasons, "未发现 DOI");
						continue;
					}
					let doiKey = this.normalizeDOI(doi);
					let existingDOIs = existingDOICache.get(targetCollectionID);
					if (!existingDOIs) {
						existingDOIs = await this.getCollectionDOISet(targetCollectionID);
						existingDOICache.set(targetCollectionID, existingDOIs);
					}
					if (existingDOIs.has(doiKey)) {
						Zotero.debug(`ZotLink: skipped duplicate DOI in collection ${targetCollectionID}: ${doiKey}`);
						skipped++;
						this.countReason(reasons, "collection 中已存在 DOI");
						continue;
					}

					let item = await this.createLinkedPDFItemFromDOI({
						doi,
						pdfPath,
						collectionID: targetCollectionID,
						index
					});
					if (item) {
						existingDOIs.add(doiKey);
						imported++;
					}
					else {
						skipped++;
						this.countReason(reasons, "创建条目失败");
					}
				}
				catch (e) {
					Zotero.logError(e);
					skipped++;
					this.countReason(reasons, e.message || "异常");
				}

				let processed = i + 1;
				if (processed === 1 || processed === pdfs.length || processed % 5 === 0) {
					this.updateProgressWindow(progressWindow, headline, `已处理 ${processed} / ${pdfs.length}，已导入 ${imported}，跳过 ${skipped}`);
				}
			}

			this.setAttachmentFileIndex(index);
			let reasonText = this.formatReasons(reasons);
			this.updateProgressWindow(progressWindow, "PDF 导入完成", `已导入 ${imported}，跳过 ${skipped}`, 5000);
			let modeText = recursive ? "递归导入 Collection 文件夹 PDF" : "导入当前 Collection 文件夹 PDF";
			this.showSoftReport(`${modeText}完成：共检查 ${pdfs.length} 个 PDF，已导入 ${imported} 个${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。`, 8000);
		},

		async getPDFImportEntriesShallow(folderPath, collectionID) {
			let children = await IOUtils.getChildren(folderPath);
			let entries = [];
			for (let child of children) {
				try {
					let stat = await IOUtils.stat(child);
					if (stat.type === "regular" && /\.pdf$/i.test(child)) {
						entries.push({
							path: child,
							collectionID
						});
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			return entries;
		},

		async getPDFImportEntriesRecursive(folderPath, collectionID) {
			let entries = [];
			let collectionCache = new Map();
			collectionCache.set("", collectionID);
			let stack = [{
				dir: folderPath,
				relativeSegments: []
			}];
			while (stack.length) {
				let current = stack.pop();
				let currentCollectionID = await this.ensureCollectionPath(collectionID, current.relativeSegments, collectionCache);
				let children;
				try {
					children = await IOUtils.getChildren(current.dir);
				}
				catch (e) {
					Zotero.logError(e);
					continue;
				}

				for (let child of children) {
					let stat;
					try {
						stat = await IOUtils.stat(child);
					}
					catch (e) {
						Zotero.logError(e);
						continue;
					}
					if (stat.type === "directory") {
						stack.push({
							dir: child,
							relativeSegments: current.relativeSegments.concat([PathUtils.filename(child)])
						});
					}
					else if (stat.type === "regular" && /\.pdf$/i.test(child)) {
						entries.push({
							path: child,
							collectionID: currentCollectionID
						});
					}
				}
			}
			return entries;
		},

		async ensureCollectionPath(rootCollectionID, relativeSegments, cache = new Map()) {
			let key = (relativeSegments || []).join("\u001f");
			if (cache.has(key)) {
				return cache.get(key);
			}

			let parentID = rootCollectionID;
			let accumulated = [];
			for (let segment of relativeSegments || []) {
				let name = String(segment || "").trim();
				if (!name) {
					continue;
				}
				accumulated.push(name);
				let childKey = accumulated.join("\u001f");
				if (cache.has(childKey)) {
					parentID = cache.get(childKey);
					continue;
				}
				parentID = await this.ensureChildCollection(parentID, name);
				cache.set(childKey, parentID);
			}
			cache.set(key, parentID);
			return parentID;
		},

		async ensureChildCollection(parentID, name) {
			let parent = Zotero.Collections.get(parentID);
			let libraryID = parent?.libraryID || Zotero.Libraries.userLibraryID;
			let child = this.findChildCollectionByName(parentID, name);
			if (child) {
				return child.id;
			}

			let collection = new Zotero.Collection();
			collection.libraryID = libraryID;
			collection.name = name;
			collection.parentID = parentID;
			return await collection.saveTx();
		},

		findChildCollectionByName(parentID, name) {
			let target = this.normalizeCollectionNameForMatch(name);
			let collections = Zotero.Collections.getByLibrary
				? Zotero.Collections.getByLibrary(Zotero.Libraries.userLibraryID)
				: [];
			for (let collection of collections || []) {
				if (Number(collection.parentID || 0) !== Number(parentID)) {
					continue;
				}
				if (this.normalizeCollectionNameForMatch(collection.name) === target) {
					return collection;
				}
			}
			return null;
		},

		normalizeCollectionNameForMatch(name) {
			return String(name || "").trim().toLocaleLowerCase();
		},

		async moveSelectedAttachmentsToCollectionPath() {
			let root = this.getAttachmentMoveRoot();
			if (!root) {
				root = this.promptForAttachmentMoveRoot();
				if (!root) {
					this.showMoveReport("请先在设置中填写附件移动顶层路径");
					return;
				}
			}

			let attachments = this.getSelectedAttachments();
			if (!attachments.length) {
				this.showMoveReport("未找到可移动的文件附件");
				return;
			}

			let pane = Zotero.getActiveZoteroPane();
			let selectedCollectionID = this.getSelectedCollectionID(pane);
			let moved = 0;
			let skipped = 0;
			let reasons = new Map();

			for (let attachment of attachments) {
				try {
					let collectionPath = this.getCollectionPathForAttachment(attachment, selectedCollectionID);
					if (!collectionPath.length) {
						this.countReason(reasons, "没有集合路径");
						skipped++;
						continue;
					}
					let destinationDir = PathUtils.join(root, ...collectionPath);
					let result = await this.moveAttachmentFileInPlace(attachment, destinationDir);
					if (result.ok) {
						await this.indexAttachmentFileID(attachment, { quiet: true });
						await this.syncAttachmentMirrors(attachment);
						moved++;
					}
					else {
						if (result.indexable) {
							await this.indexAttachmentFileID(attachment, { quiet: true });
							await this.syncAttachmentMirrors(attachment);
						}
						this.countReason(reasons, result.reason || "未知原因");
						skipped++;
					}
				}
				catch (e) {
					Zotero.logError(e);
					this.countReason(reasons, e.message || "异常");
					skipped++;
				}
			}

			pane.itemsView?.refreshAndMaintainSelection?.();
			let reasonText = this.formatReasons(reasons);
			this.showMoveReport(`已移动 ${moved} 个附件${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}`);
		},

		async getCollectionDOISet(collectionID) {
			let dois = new Set();
			let rows = await Zotero.DB.queryAsync(
				"SELECT CI.itemID FROM collectionItems CI JOIN items I ON CI.itemID=I.itemID LEFT JOIN deletedItems DI ON CI.itemID=DI.itemID WHERE CI.collectionID=? AND I.libraryID=? AND DI.itemID IS NULL",
				[collectionID, Zotero.Libraries.userLibraryID]
			);
			for (let row of rows) {
				try {
					let itemID = row.itemID || row.itemid || row[0];
					let item = await Zotero.Items.getAsync(itemID);
					if (!item?.isRegularItem?.() || item.deleted) {
						continue;
					}
					let doi = item?.getField?.("DOI");
					if (doi) {
						dois.add(this.normalizeDOI(doi));
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			return dois;
		},

		normalizeDOI(doi) {
			let value = String(doi || "")
				.trim()
				.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
				.replace(/^doi:\s*/i, "")
				.replace(/\)\/s\/[a-z0-9_-]+.*$/i, "")
				.replace(/\/s\/uri.*$/i, "")
				.replace(/[)\].,;:，。；：]+$/g, "")
				.toLowerCase();
			let match = value.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
			if (match) {
				value = match[0]
					.replace(/\)\/s\/[a-z0-9_-]+.*$/i, "")
					.replace(/\/s\/uri.*$/i, "")
					.replace(/[)\].,;:，。；：]+$/g, "");
			}
			return value.toLowerCase();
		},

		async createLinkedPDFItemFromDOI({ doi, pdfPath, collectionID, index }) {
			let item = await this.createRegularItemFromDOI({
				doi,
				pdfPath,
				collectionID
			});

			let attachment = new Zotero.Item("attachment");
			attachment.libraryID = Zotero.Libraries.userLibraryID;
			attachment.parentID = item.id;
			attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
			attachment.attachmentPath = pdfPath;
			attachment.attachmentContentType = "application/pdf";
			attachment.setField("title", PathUtils.filename(pdfPath));
			await attachment.saveTx();
			await this.indexAttachmentFileID(attachment, {
				quiet: true,
				index,
				save: false
			});
			return item;
		},

		async createRegularItemFromDOI({ doi, pdfPath, collectionID }) {
			let metadata = await this.lookupMetadataByDOI(doi);
			let item = this.createItemFromTranslatedMetadata(metadata, doi, pdfPath);
			item.libraryID = Zotero.Libraries.userLibraryID;
			if (typeof item.setCollections === "function") {
				item.setCollections(collectionID ? [collectionID] : []);
			}
			let itemID = await item.saveTx();
			if (collectionID && typeof item.setCollections !== "function") {
				await Zotero.DB.queryAsync(
					"INSERT OR IGNORE INTO collectionItems (collectionID, itemID) VALUES (?, ?)",
					[collectionID, itemID]
				);
			}
			return item;
		},

		async renameSelectedPrimaryPDFsByRule() {
			let attachments = await this.getSelectedPrimaryPDFAttachments();
			if (!attachments.length) {
				this.showMoveReport("未找到可按规则重命名的主 PDF 附件");
				return;
			}

			let renamed = 0;
			let skipped = 0;
			let reasons = new Map();
			for (let attachment of attachments) {
				try {
					let result = await this.renameAttachmentByRule(attachment, { silent: true });
					if (result.ok && result.changed) {
						await this.indexAttachmentFileID(attachment, { quiet: true });
						await this.syncAttachmentMirrors(attachment);
						renamed++;
					}
					else {
						skipped++;
						this.countReason(reasons, result.reason || "未知原因");
					}
				}
				catch (e) {
					Zotero.logError(e);
					skipped++;
					this.countReason(reasons, e.message || "异常");
				}
			}

			let reasonText = this.formatReasons(reasons);
			this.showMoveReport(`主 PDF 按规则重命名完成：共检查 ${attachments.length} 个主 PDF，已重命名 ${renamed} 个${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。`);
		},

		async renameAttachmentByRule(attachment, options = {}) {
			if (!attachment?.isFileAttachment?.()) {
				return { ok: false, changed: false, reason: "不是文件附件" };
			}
			if (attachment.libraryID !== Zotero.Libraries.userLibraryID) {
				return { ok: false, changed: false, reason: "非个人库附件" };
			}
			let sourcePath = attachment.getFilePath();
			if (!sourcePath || !(await IOUtils.exists(sourcePath))) {
				return { ok: false, changed: false, reason: "源文件不存在" };
			}
			if (!this.isPDFFilePath(sourcePath, attachment)) {
				return { ok: false, changed: false, reason: "不是 PDF" };
			}
			let parent = attachment.parentItem;
			if (!parent?.isRegularItem?.()) {
				return { ok: false, changed: false, reason: "没有父条目" };
			}

			let pattern = String(options.pattern || this.getPref("attachmentRenamePattern", DEFAULT_ATTACHMENT_RENAME_PATTERN) || DEFAULT_ATTACHMENT_RENAME_PATTERN).trim();
			let baseName = this.buildAttachmentRenameBaseName(parent, pattern);
			if (!baseName) {
				return { ok: false, changed: false, reason: "无法生成文件名" };
			}

			let extension = Zotero.File.getExtension(sourcePath) || "pdf";
			let destinationPath = PathUtils.join(this.getParentPath(sourcePath), `${baseName}.${extension}`);
			if (this.pathsEqual(sourcePath, destinationPath)) {
				return { ok: true, changed: false, reason: "文件名已符合规则" };
			}
			destinationPath = await this.getUniqueDestinationPath(destinationPath);
			if (!destinationPath) {
				return { ok: false, changed: false, reason: "无法生成唯一文件名" };
			}

			await IOUtils.move(sourcePath, destinationPath);
			try {
				await this.updateAttachmentLinkedPath(attachment, destinationPath);
				if (!options.silent) {
					this.showSoftReport(`已重命名 PDF：${PathUtils.filename(destinationPath)}`, 3000);
				}
				return { ok: true, changed: true, path: destinationPath };
			}
			catch (e) {
				Zotero.logError(e);
				try {
					await IOUtils.move(destinationPath, sourcePath);
				}
				catch (rollbackError) {
					Zotero.logError(rollbackError);
					return { ok: false, changed: false, reason: "更新 Zotero 路径失败且回滚失败" };
				}
				return { ok: false, changed: false, reason: "Zotero 拒绝更新附件路径" };
			}
		},

		buildAttachmentRenameBaseName(item, pattern) {
			let replacements = this.getAttachmentRenameReplacements(item);
			let name = String(pattern || DEFAULT_ATTACHMENT_RENAME_PATTERN).replace(/\{(author|authors|year|title|doi)\}/gi, (match, key) => {
				return replacements[key.toLowerCase()] || "";
			});
			return this.sanitizeFilename(name.replace(/\s+/g, " ").trim()).slice(0, 180);
		},

		getAttachmentRenameReplacements(item) {
			let creators = [];
			try {
				creators = item.getCreators?.() || [];
			}
			catch (e) {
				Zotero.logError(e);
			}
			let authorNames = creators
				.map(creator => creator.lastName || creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" "))
				.map(name => String(name || "").trim())
				.filter(Boolean);
			let firstAuthor = authorNames[0] || "Unknown";
			let authors = authorNames.length > 1 ? `${firstAuthor} et al.` : firstAuthor;
			let title = String(item.getField?.("title") || "").trim();
			let date = String(item.getField?.("date") || "").trim();
			let year = (date.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/) || [])[1] || "";
			let doi = this.normalizeDOI(item.getField?.("DOI"));
			return {
				author: firstAuthor,
				authors,
				year,
				title,
				doi
			};
		},

		sanitizeFilename(name) {
			return String(name || "")
				.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
				.replace(/\s+/g, " ")
				.replace(/[. ]+$/g, "")
				.trim();
		},

		async writeAttachmentPDFDOIMetadata(attachment, options = {}) {
			if (!attachment?.isFileAttachment?.()) {
				return { ok: false, changed: false, reason: "不是文件附件" };
			}
			if (attachment.libraryID !== Zotero.Libraries.userLibraryID) {
				return { ok: false, changed: false, reason: "非个人库附件" };
			}
			let path = attachment.getFilePath();
			if (!path || !(await IOUtils.exists(path))) {
				return { ok: false, changed: false, reason: "源文件不存在" };
			}
			if (!this.isPDFFilePath(path, attachment)) {
				return { ok: false, changed: false, reason: "不是 PDF" };
			}

			let doi = this.getAttachmentParentDOI(attachment);
			if (!doi) {
				return { ok: false, changed: false, reason: "父条目无 DOI" };
			}

			let result = await this.writePDFDOIMetadataWithPikepdf(path, doi);
			if (result.ok && result.changed && !options.silent) {
				this.showSoftReport(`已写入 PDF DOI 元数据：${PathUtils.filename(path)}`, 3000);
			}
			return result;
		},

		async writeSelectedPDFDOIMetadata() {
			let attachments = await this.getSelectedPrimaryPDFAttachments();
			if (!attachments.length) {
				this.showMoveReport("未找到可写入 DOI 元数据的主 PDF 附件");
				return;
			}

			let written = 0;
			let skipped = 0;
			let reasons = new Map();
			for (let attachment of attachments) {
				try {
					let result = await this.writeAttachmentPDFDOIMetadata(attachment, { silent: true });
					if (result.ok && result.changed) {
						written++;
					}
					else {
						skipped++;
						this.countReason(reasons, result.reason || "未知原因");
					}
				}
				catch (e) {
					Zotero.logError(e);
					skipped++;
					this.countReason(reasons, e.message || "异常");
				}
			}

			let reasonText = this.formatReasons(reasons);
			this.showMoveReport(`选中主 PDF DOI 元数据写入完成：共检查 ${attachments.length} 个主 PDF，已写入 ${written} 个${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。`);
		},

		getAttachmentParentDOI(attachment) {
			let parent = attachment?.parentItem;
			if (!parent?.isRegularItem?.()) {
				return "";
			}
			return this.normalizeDOI(parent.getField?.("DOI"));
		},

		isPDFFilePath(path, attachment = null) {
			let contentType = String(attachment?.attachmentContentType || "").toLowerCase();
			return contentType === "application/pdf" || /\.pdf$/i.test(String(path || ""));
		},

		async writePDFDOIMetadataWithPikepdf(pdfPath, doi) {
			let outputPath = this.getTempTextPath("zotlink-pdf-metadata");
			let scriptPath = this.getTempTextPath("zotlink-pdf-metadata").replace(/\.txt$/i, ".py");
			let script = [
				"import json, os, shutil, sys, tempfile, traceback",
				"path, doi, output = sys.argv[1], sys.argv[2], sys.argv[3]",
				"def finish(**data):",
				"    with open(output, 'w', encoding='utf-8') as f:",
				"        json.dump(data, f, ensure_ascii=False)",
				"try:",
				"    import pikepdf",
				"except Exception as e:",
				"    finish(ok=False, changed=False, reason='缺少 pikepdf', detail=str(e))",
				"    sys.exit(0)",
				"try:",
				"    doi_url = 'https://doi.org/' + doi",
				"    with pikepdf.Pdf.open(path, allow_overwriting_input=True) as pdf:",
				"        info = pdf.docinfo",
				"        existing_doi = str(info.get('/doi', '') or '').strip()",
				"        existing_url = str(info.get('/doiURL', '') or '').strip()",
				"        if existing_doi and existing_url:",
				"            finish(ok=True, changed=False, reason='已存在完整 DOI metadata', existingDOI=existing_doi, existingDOIURL=existing_url)",
				"            sys.exit(0)",
				"        if not existing_doi:",
				"            info['/doi'] = doi",
				"        if not existing_url:",
				"            info['/doiURL'] = doi_url",
				"        fd, tmp_name = tempfile.mkstemp(prefix=os.path.splitext(os.path.basename(path))[0] + '.', suffix='.pdf', dir=os.path.dirname(path) or None)",
				"        os.close(fd)",
				"        try:",
				"            pdf.save(tmp_name)",
				"            shutil.move(tmp_name, path)",
				"        finally:",
				"            if os.path.exists(tmp_name):",
				"                os.unlink(tmp_name)",
				"    finish(ok=True, changed=True, reason='已补写 DOI metadata', wroteDOI=(not existing_doi), wroteDOIURL=(not existing_url))",
				"except Exception as e:",
				"    finish(ok=False, changed=False, reason='写入失败', detail=''.join(traceback.format_exception_only(type(e), e)).strip())"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(script));
				let execResult = await this.execDiagnosticCommand("C:\\Windows\\pyw.exe", [
					"-3",
					scriptPath,
					pdfPath,
					doi,
					outputPath
				]);
				let text = await this.readCommandOutputFile(outputPath, "");
				let result = {};
				try {
					result = JSON.parse(text || "{}");
				}
				catch (e) {
					result = {
						ok: false,
						changed: false,
						reason: "无法解析写入结果",
						detail: text || execResult.diagnostic
					};
				}
				if (!result.ok) {
					Zotero.debug(`ZotLink PDF DOI metadata write skipped/failed: ${result.reason || ""} ${result.detail || ""}`, 1);
				}
				return result;
			}
			catch (e) {
				Zotero.logError(e);
				return {
					ok: false,
					changed: false,
					reason: "执行 Python 失败",
					detail: this.errorToText(e)
				};
			}
			finally {
				for (let path of [scriptPath, outputPath]) {
					try {
						if (await IOUtils.exists(path)) {
							await IOUtils.remove(path);
						}
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
			}
		},

		async writeAllLibraryPDFDOIMetadata(options = {}) {
			let attachments = await this.getAllUserFileAttachments();
			attachments = attachments.filter(attachment => this.isPDFFilePath(attachment.getFilePath?.(), attachment));
			if (!attachments.length) {
				if (options.softReport) {
					this.showSoftReport("个人库中未找到 PDF 文件附件。", 5000);
				}
				else {
					this.showPreferenceAlert("PDF DOI 元数据写入结果", "个人库中未找到 PDF 文件附件。");
				}
				return;
			}

			let written = 0;
			let skipped = 0;
			let reasons = new Map();
			let startedAt = Date.now();
			let useProgressWindow = options.useProgressWindow !== false;
			let progressWindow = useProgressWindow
				? this.createProgressWindow("正在写入 PDF DOI 元数据", `已处理 0 / ${attachments.length}`)
				: null;

			for (let i = 0; i < attachments.length; i++) {
				let attachment = attachments[i];
				try {
					let result = await this.writeAttachmentPDFDOIMetadata(attachment, { silent: true });
					if (result.ok && result.changed) {
						written++;
					}
					else {
						skipped++;
						this.countReason(reasons, result.reason || "未知原因");
					}
				}
				catch (e) {
					Zotero.logError(e);
					skipped++;
					this.countReason(reasons, e.message || "异常");
				}

				let processed = i + 1;
				if (processed === 1 || processed === attachments.length || processed % 10 === 0) {
					options.onProgress?.({
						processed,
						total: attachments.length,
						written,
						skipped
					});
					this.updateProgressWindow(progressWindow, "正在写入 PDF DOI 元数据", `已处理 ${processed} / ${attachments.length}，已写入 ${written}，跳过 ${skipped}`);
				}
			}

			let seconds = Math.round((Date.now() - startedAt) / 1000);
			let reasonText = this.formatReasons(reasons);
			let message = `全库 PDF DOI 元数据写入完成：共检查 ${attachments.length} 个 PDF 附件，已写入 ${written} 个${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。耗时约 ${seconds} 秒。`;
			this.updateProgressWindow(progressWindow, "PDF DOI 元数据写入完成", `已写入 ${written}，跳过 ${skipped}，耗时约 ${seconds} 秒`, 6000);
			if (options.softReport) {
				this.showSoftReport(message, 8000);
			}
			else {
				this.showPreferenceAlert("PDF DOI 元数据写入结果", message);
			}
		},

		async lookupMetadataByDOI(doi) {
			try {
				let translate = new Zotero.Translate.Search();
				translate.setIdentifier({
					itemType: "journalArticle",
					DOI: doi
				});
				let translators = await translate.getTranslators();
				if (!translators?.length) {
					return null;
				}
				translate.setTranslator(translators);
				let items = await translate.translate({ libraryID: false });
				return items?.[0] || null;
			}
			catch (e) {
				Zotero.logError(e);
				return null;
			}
		},

		createItemFromTranslatedMetadata(metadata, doi, pdfPath) {
			let itemType = metadata?.itemType || "journalArticle";
			let item = new Zotero.Item(itemType);
			let skipped = new Set([
				"itemType",
				"creators",
				"attachments",
				"notes",
				"tags",
				"collections",
				"seeAlso"
			]);

			if (metadata && typeof metadata === "object") {
				for (let [field, value] of Object.entries(metadata)) {
					if (skipped.has(field) || value === undefined || value === null || value === "") {
						continue;
					}
					try {
						item.setField(field, value);
					}
					catch (e) {
						// Search translators may return fields not valid for the detected item type.
					}
				}
				if (Array.isArray(metadata.creators) && metadata.creators.length) {
					try {
						item.setCreators(metadata.creators);
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
				if (Array.isArray(metadata.tags)) {
					for (let tag of metadata.tags) {
						try {
							item.addTag(typeof tag === "string" ? tag : tag.tag);
						}
						catch (e) {
							Zotero.logError(e);
						}
					}
				}
			}

			if (!item.getField("title")) {
				item.setField("title", this.titleFromPDFPath(pdfPath));
			}
			if (!item.getField("DOI")) {
				item.setField("DOI", doi);
			}
			return item;
		},

		titleFromPDFPath(pdfPath) {
			return PathUtils.filename(pdfPath)
				.replace(/\.pdf$/i, "")
				.replace(/[_-]+/g, " ")
				.trim();
		},

		async extractDOIFromPDFMetadata(pdfPath) {
			let outputPath = this.getTempTextPath("zotlink-pdf-doi");
			let scriptPath = this.getTempTextPath("zotlink-pdf-doi").replace(/\.txt$/i, ".py");
			let script = [
				"import html, re, sys, zlib",
				"path, output = sys.argv[1], sys.argv[2]",
				"doi_re = re.compile(rb'10\\.\\d{4,9}/[-._;()/:A-Z0-9]+', re.I)",
				"ref_re = re.compile(rb'(\\d+)\\s+(\\d+)\\s+obj\\b')",
				"doi = ''",
				"def decoded_texts(raw):",
				"    out = []",
				"    for enc in ('utf-8-sig', 'utf-16', 'utf-16-be', 'utf-16-le', 'latin-1'):",
				"        try:",
				"            text = raw.decode(enc, 'ignore')",
				"        except Exception:",
				"            continue",
				"        text = text.replace('\\x00', '')",
				"        if text and text not in out:",
				"            out.append(text)",
				"    return out",
				"def clean(raw):",
				"    for text in decoded_texts(raw):",
				"        text = html.unescape(text)",
				"        m = re.search(r'10\\.\\d{4,9}/[-._;()/:A-Z0-9]+', text, re.I)",
				"        if not m:",
				"            continue",
				"        value = m.group(0).strip()",
				"        value = re.sub(r'\\)/s/[a-z0-9_-]+.*$', '', value, flags=re.I)",
				"        value = re.sub(r'/s/uri.*$', '', value, flags=re.I)",
				"        return value.rstrip(').,;:]')",
				"    return ''",
				"def decode_pdf_literal(raw):",
				"    out = bytearray()",
				"    i = 0",
				"    while i < len(raw):",
				"        ch = raw[i]",
				"        if ch != 92:",
				"            out.append(ch)",
				"            i += 1",
				"            continue",
				"        i += 1",
				"        if i >= len(raw):",
				"            break",
				"        esc = raw[i]",
				"        if 48 <= esc <= 55:",
				"            digits = bytes([esc])",
				"            i += 1",
				"            for _ in range(2):",
				"                if i < len(raw) and 48 <= raw[i] <= 55:",
				"                    digits += bytes([raw[i]])",
				"                    i += 1",
				"                else:",
				"                    break",
				"            out.append(int(digits, 8) & 255)",
				"            continue",
				"        mapping = {ord('n'): 10, ord('r'): 13, ord('t'): 9, ord('b'): 8, ord('f'): 12, ord('('): 40, ord(')'): 41, 92: 92}",
				"        if esc in (10, 13):",
				"            i += 1",
				"            if esc == 13 and i < len(raw) and raw[i] == 10:",
				"                i += 1",
				"            continue",
				"        out.append(mapping.get(esc, esc))",
				"        i += 1",
				"    return bytes(out)",
				"def decode_pdf_value(raw):",
				"    raw = raw.strip()",
				"    if raw.startswith(b'(') and raw.endswith(b')'):",
				"        raw = raw[1:-1]",
				"        return decode_pdf_literal(raw)",
				"    if raw.startswith(b'<') and raw.endswith(b'>') and not raw.startswith(b'<<'):",
				"        try:",
				"            return bytes.fromhex(raw[1:-1].decode('ascii', 'ignore'))",
				"        except Exception:",
				"            return raw",
				"    return raw",
				"def doi_from_metadata_fields(raw):",
				"    for m in re.finditer(rb'/(?:doi|DOI|Doi|prism:doi|dc:identifier|Identifier)\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[^<>\\s]+>|[^/<>{}\\[\\]\\s]+)', raw, re.I):",
				"        found = clean(decode_pdf_value(m.group(1)))",
				"        if found:",
				"            return found",
				"    xml_patterns = [",
				"        r'<[^>]*(?:doi|identifier)[^>]*>\\s*([^<]+)',",
				"        r'(?:doi|DOI|identifier)\\s*=\\s*[\\\"\\']([^\\\"\\']+)',",
				"        r'(?:doi|DOI|identifier)\\s*[:=]\\s*([^\\r\\n<>]+)'",
				"    ]",
				"    for text in decoded_texts(raw):",
				"        text = html.unescape(text)",
				"        for pat in xml_patterns:",
				"            for m in re.finditer(pat, text, re.I):",
				"                found = clean(m.group(1).encode('utf-8', 'ignore'))",
				"                if found:",
				"                    return found",
				"    return ''",
				"def object_body(data, obj_num):",
				"    pat = re.compile(rb'\\b' + str(obj_num).encode() + rb'\\s+\\d+\\s+obj\\b')",
				"    m = pat.search(data)",
				"    if not m:",
				"        return b''",
				"    end = data.find(b'endobj', m.end())",
				"    return data[m.end(): end if end > 0 else len(data)]",
				"def stream_data(body):",
				"    s = body.find(b'stream')",
				"    e = body.find(b'endstream', s + 6)",
				"    if s < 0 or e < 0:",
				"        return body",
				"    raw = body[s + 6:e].strip(b'\\r\\n ')",
				"    if b'/FlateDecode' in body:",
				"        try:",
				"            return zlib.decompress(raw)",
				"        except Exception:",
				"            return raw",
				"    return raw",
				"def refs_from(pattern, data):",
				"    out = []",
				"    for m in re.finditer(pattern, data, re.S):",
				"        out.append(int(m.group(1)))",
				"    return out",
				"def iter_object_bodies(data):",
				"    for m in ref_re.finditer(data):",
				"        end = data.find(b'endobj', m.end())",
				"        if end > 0:",
				"            yield data[m.end():end]",
				"def looks_like_metadata(body):",
				"    low = body[:4096].lower()",
				"    return (b'/metadata' in low or b'/info' in low or b'xmpmeta' in low or b'rdf:' in low or b'prism:doi' in low or b'dc:identifier' in low or b'/doi' in low or b'/doi' in body.lower())",
				"with open(path, 'rb') as f:",
				"    data = f.read()",
				"# Strict-ish metadata path: XMP Metadata streams and Info dictionaries.",
				"candidate_refs = []",
				"candidate_refs += refs_from(rb'/Metadata\\s+(\\d+)\\s+\\d+\\s+R', data)",
				"candidate_refs += refs_from(rb'/Info\\s+(\\d+)\\s+\\d+\\s+R', data)",
				"seen = set()",
				"for ref in candidate_refs:",
				"    if ref in seen:",
				"        continue",
				"    seen.add(ref)",
				"    body = object_body(data, ref)",
				"    if not body:",
				"        continue",
				"    stream = stream_data(body)",
				"    doi = doi_from_metadata_fields(stream) or doi_from_metadata_fields(body)",
				"    if not doi:",
				"        doi = clean(stream) or clean(body)",
				"    if doi:",
				"        break",
				"# Metadata fallback: inspect objects that look like Info/XMP/custom metadata even if they were not referenced in the trailer/catalog pattern above.",
				"if not doi:",
				"    for body in iter_object_bodies(data):",
				"        if not looks_like_metadata(body):",
				"            continue",
				"        stream = stream_data(body)",
				"        doi = doi_from_metadata_fields(stream) or doi_from_metadata_fields(body) or clean(stream) or clean(body)",
				"        if doi:",
				"            break",
				"# Lightweight fallback: limited bytes near file start/end, not full-text extraction.",
				"if not doi:",
				"    limited = data[:2 * 1024 * 1024] + b'\\n' + data[-1024 * 1024:]",
				"    doi = clean(limited)",
				"with open(output, 'w', encoding='utf-8') as out:",
				"    out.write(doi)"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(script));
				await this.execDiagnosticCommand("C:\\Windows\\pyw.exe", [
					"-3",
					scriptPath,
					pdfPath,
					outputPath
				]);
				return this.normalizeDOI(await this.readCommandOutputFile(outputPath, ""));
			}
			catch (e) {
				Zotero.logError(e);
				return "";
			}
			finally {
				for (let path of [scriptPath, outputPath]) {
					try {
						if (await IOUtils.exists(path)) {
							await IOUtils.remove(path);
						}
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
			}
		},

		getAttachmentMoveRoot() {
			return String(this.getPref("attachmentMoveRoot", DEFAULT_ATTACHMENT_MOVE_ROOT) || "").trim();
		},

		promptForAttachmentMoveRoot() {
			if (!LFServices?.prompt?.prompt) {
				return "";
			}

			let value = { value: DEFAULT_ATTACHMENT_MOVE_ROOT };
			let ok = LFServices.prompt.prompt(
				Zotero.getMainWindow(),
				"附件移动顶层路径",
				"请输入附件移动顶层路径",
				value,
				null,
				{}
			);
			let root = ok ? String(value.value || "").trim() : "";
			if (root) {
				this.setPref("attachmentMoveRoot", root);
			}
			return root;
		},

		async showMoveReport(message) {
			this.setPref("lastMoveReport", message);
			Zotero.debug("ZotLink move report: " + message);

			let displayMessage = String(message || "");
			if (displayMessage.length > 1400) {
				try {
					let reportPath = await this.writeTextReport("zotlink-report", displayMessage);
					displayMessage = displayMessage.slice(0, 1100)
						+ "\n\n...[完整内容太长，已写入报告文件]\n"
						+ reportPath;
				}
				catch (e) {
					Zotero.logError(e);
					displayMessage = displayMessage.slice(0, 1300)
						+ "\n\n...[完整内容太长，但报告文件写入失败]";
				}
			}

			if (LFServices?.prompt?.alert) {
				LFServices.prompt.alert(Zotero.getMainWindow(), "附件移动结果", displayMessage);
				return;
			}

			this.showStatus(displayMessage, 8000);
		},

		showSoftReport(message, closeAfter = 5000) {
			let displayMessage = String(message || "");
			this.setPref("lastMoveReport", displayMessage);
			Zotero.debug("ZotLink report: " + displayMessage);
			if (displayMessage.length > 900) {
				displayMessage = displayMessage.slice(0, 860) + "\n……";
			}
			this.showStatus(displayMessage, closeAfter);
		},

		showHardlinkDiagnostic(lines) {
			let message = (lines || [])
				.filter(line => line !== null && line !== undefined)
				.map(line => String(line))
				.join("\n");
			if (!message) {
				message = "没有诊断信息。";
			}
			if (message.length > 3500) {
				message = message.slice(0, 3500) + "\n\n……内容过长，已截断。";
			}
			Zotero.debug("ZotLink hardlink diagnostic:\n" + message);
			this.showAlert("ZotLink 硬链接诊断", message);
		},

		formatMirrorDiagnosticLine(attachment, result = {}) {
			let parts = [
				`${this.getItemDisplayName(attachment)}：${result.changed ? "已更新" : "无变化"}`,
				`目标路径 ${result.desiredPathCount ?? 0}`,
				`快捷方式 ${result.shortcutPathCount ?? result.hardlinkPathCount ?? 0}`
			];
			if ((result.desiredPathCount ?? 0) <= 1) {
				parts.push("说明：当前只检测到一个 collection 路径，因此不会创建额外快捷方式");
			}
			if (result.reason) {
				parts.push(`原因：${result.reason}`);
			}
			if (result.primaryPath) {
				parts.push(`主路径：${result.primaryPath}`);
			}
			if (Array.isArray(result.desiredPaths) && result.desiredPaths.length) {
				parts.push(`目标：${result.desiredPaths.join(" | ")}`);
			}
			if (Array.isArray(result.shortcutPaths) && result.shortcutPaths.length) {
				parts.push(`快捷方式：${result.shortcutPaths.join(" | ")}`);
			}
			else if (Array.isArray(result.hardlinkPaths) && result.hardlinkPaths.length) {
				parts.push(`硬链接：${result.hardlinkPaths.join(" | ")}`);
			}
			if (Array.isArray(result.diagnostics) && result.diagnostics.length) {
				parts.push(`失败诊断：${result.diagnostics.join("；")}`);
			}
			return parts.join("；");
		},

		getItemDisplayName(item) {
			return item?.getField?.("title") || item?.attachmentFilename || item?.key || `item ${item?.id || ""}`;
		},

		countReason(reasons, reason) {
			reasons.set(reason, (reasons.get(reason) || 0) + 1);
		},

		formatReasons(reasons) {
			return Array.from(reasons.entries())
				.map(([reason, count]) => `${reason}×${count}`)
				.join("；");
		},

		getSelectedCollectionID(pane) {
			if (pane.getSelectedCollections) {
				let collections = pane.getSelectedCollections();
				return collections?.length ? collections[0].id : null;
			}
			let collection = pane.getSelectedCollection?.();
			return collection ? collection.id : null;
		},

		getCollectionPathForAttachment(attachment, selectedCollectionID) {
			let parent = attachment.parentItem;
			if (!parent) {
				return [];
			}

			let collectionIDs = parent.getCollections();
			let collectionID = null;
			if (selectedCollectionID && collectionIDs.includes(selectedCollectionID)) {
				collectionID = selectedCollectionID;
			}
			else {
				collectionID = collectionIDs[0];
			}

			if (!collectionID) {
				return [];
			}

			let names = [];
			let collection = Zotero.Collections.get(collectionID);
			while (collection) {
				names.unshift(this.sanitizePathSegment(collection.name));
				collection = collection.parentID ? Zotero.Collections.get(collection.parentID) : null;
			}
			return names.filter(Boolean);
		},

		getCollectionPathsForAttachment(attachment) {
			let parent = attachment.parentItem;
			if (!parent?.getCollections) {
				return [];
			}

			let paths = [];
			for (let collectionID of parent.getCollections()) {
				let names = [];
				let collection = Zotero.Collections.get(collectionID);
				while (collection) {
					names.unshift(this.sanitizePathSegment(collection.name));
					collection = collection.parentID ? Zotero.Collections.get(collection.parentID) : null;
				}
				let path = names.filter(Boolean);
				if (path.length) {
					paths.push(path);
				}
			}
			return paths;
		},

		getDesiredHardlinkPathsForAttachment(attachment, fileName) {
			let root = this.getAttachmentMoveRoot();
			if (!root || !fileName) {
				return [];
			}
			return this.getDesiredAttachmentPathRecords(attachment, fileName)
				.map(record => record.path);
		},

		getDesiredAttachmentPathRecords(attachment, fileName) {
			let root = this.getAttachmentMoveRoot();
			let parent = attachment.parentItem;
			if (!root || !fileName || !parent?.getCollections) {
				return [];
			}

			let records = [];
			for (let collectionID of parent.getCollections()) {
				let collectionPath = this.getCollectionPathByID(collectionID);
				if (collectionPath.length) {
					records.push({
						collectionID,
						path: PathUtils.join(root, ...collectionPath, fileName)
					});
				}
			}
			return records;
		},

		getCollectionPathByID(collectionID) {
			let names = [];
			let collection = Zotero.Collections.get(collectionID);
			while (collection) {
				names.unshift(this.sanitizePathSegment(collection.name));
				collection = collection.parentID ? Zotero.Collections.get(collection.parentID) : null;
			}
			return names.filter(Boolean);
		},

		async syncAttachmentMirrors(attachment, options = {}) {
			if (!attachment?.isFileAttachment?.()) {
				return { changed: false, reason: "不是文件附件" };
			}

			let currentPath = attachment.getFilePath();
			if (!currentPath || !(await IOUtils.exists(currentPath))) {
				return { changed: false, reason: "源文件不存在" };
			}

			let locator = await this.getWindowsFileID(currentPath, { quiet: true });
			if (!locator.fileID) {
				return { changed: false, reason: "无法读取机内码" };
			}

			let index = options.index || this.getAttachmentFileIndex();
			let diagnostics = Array.isArray(options.diagnostics) ? options.diagnostics : [];
			let record = this.normalizeAttachmentIndexRecord(attachment, index[attachment.key]);
			let fileName = PathUtils.filename(currentPath);
			let desiredRecords = this.getDesiredAttachmentPathRecords(attachment, fileName);
			let desiredPaths = this.uniquePaths(desiredRecords.map(record => record.path));
			if (!desiredPaths.length) {
				return { changed: false, reason: "没有集合路径" };
			}

			let preferredPath = this.getPreferredPrimaryPath(desiredRecords, options.preferredCollectionID);
			let currentIsDesired = desiredPaths.some(path => this.pathsEqual(path, currentPath));
			let primaryPath = currentPath;
			let changed = false;

			if (!currentIsDesired || (preferredPath && !this.pathsEqual(preferredPath, currentPath))) {
				let targetPrimaryPath = preferredPath || desiredPaths[0];
				let existingPrimary = await this.getExistingPathWithFileID(targetPrimaryPath, locator.fileID);
				let replacement = existingPrimary || await this.movePrimaryAttachmentFile(currentPath, targetPrimaryPath, diagnostics);
				if (replacement) {
					await this.updateAttachmentLinkedPath(attachment, replacement);
					if (existingPrimary && !this.pathsEqual(existingPrimary, currentPath)) {
						try {
							await IOUtils.remove(currentPath);
						}
						catch (e) {
							Zotero.logError(e);
						}
					}
					primaryPath = replacement;
					currentPath = replacement;
					changed = true;
				}
			}

			let shortcutPaths = [];
			let primaryShortcutPath = this.getShortcutPathForTargetPath(primaryPath);
			let removedShortcutPaths = this.getRemovedCollectionShortcutPaths(options.removedCollectionIDs, fileName);
			for (let desiredPath of desiredPaths) {
				if (this.pathsEqual(desiredPath, primaryPath)) {
					continue;
				}
				let shortcutPath = this.getShortcutPathForTargetPath(desiredPath);
				let path = await this.ensureShortcutPath(primaryPath, shortcutPath, diagnostics);
				if (path) {
					shortcutPaths.push(path);
				}
			}

			let stalePaths = this.uniquePaths([
				primaryShortcutPath,
				...removedShortcutPaths,
				...(record.shortcutPaths || []),
				...(record.hardlinkPaths || []),
				...(record.path && !this.pathsEqual(record.path, primaryPath) ? [record.path] : [])
			]).filter(path => !this.pathsEqual(path, primaryPath)
				&& !shortcutPaths.some(shortcutPath => this.pathsEqual(shortcutPath, path))
				&& !desiredPaths.some(desiredPath => this.pathsEqual(desiredPath, path))
				&& (this.pathsEqual(path, primaryShortcutPath)
					|| !desiredPaths.some(desiredPath => this.pathsEqual(this.getShortcutPathForTargetPath(desiredPath), path))));
			for (let stalePath of stalePaths) {
				try {
					if (await IOUtils.exists(stalePath) && await this.isRemovableMirrorPath(stalePath, primaryPath, locator.fileID)) {
						await IOUtils.remove(stalePath);
						changed = true;
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}

			let recordChanged = String(record.fileID || "").toLowerCase() !== String(locator.fileID || "").toLowerCase()
				|| !this.pathsEqual(record.primaryPath, primaryPath)
				|| !this.samePathList(record.shortcutPaths || [], shortcutPaths)
				|| (record.hardlinkPaths || []).length > 0;
			let nextRecord = {
				...record,
				itemID: attachment.id,
				key: attachment.key,
				fileID: locator.fileID,
				path: primaryPath,
				primaryPath,
				shortcutPaths,
				hardlinkPaths: [],
				fileName: PathUtils.filename(primaryPath),
				updatedAt: new Date().toISOString()
			};
			changed = changed || recordChanged;
			if (changed) {
				index[attachment.key] = nextRecord;
			}
			if (changed && options.save !== false) {
				this.setAttachmentFileIndex(index);
			}
			return {
				changed,
				desiredPathCount: desiredPaths.length,
				desiredPaths,
				shortcutPathCount: shortcutPaths.length,
				primaryPath,
				shortcutPaths,
				diagnostics
			};
		},

		async syncAttachmentHardlinks(attachment, options = {}) {
			// Legacy compatibility wrapper: ZotLink now uses .lnk shortcut mirrors by default.
			return this.syncAttachmentMirrors(attachment, options);
		},

		getPreferredPrimaryPath(desiredRecords, preferredCollectionID) {
			preferredCollectionID = Number(preferredCollectionID);
			if (!Number.isInteger(preferredCollectionID) || preferredCollectionID <= 0) {
				return "";
			}
			return desiredRecords.find(record => Number(record.collectionID) === preferredCollectionID)?.path || "";
		},

		getRemovedCollectionShortcutPaths(collectionIDs, fileName) {
			let root = this.getAttachmentMoveRoot();
			if (!root || !fileName) {
				return [];
			}
			let paths = [];
			for (let collectionID of collectionIDs || []) {
				let collectionPath = this.getCollectionPathByID(collectionID);
				if (collectionPath.length) {
					paths.push(this.getShortcutPathForTargetPath(PathUtils.join(root, ...collectionPath, fileName)));
				}
			}
			return this.uniquePaths(paths);
		},

		samePathList(left, right) {
			left = this.uniquePaths(left || []);
			right = this.uniquePaths(right || []);
			if (left.length !== right.length) {
				return false;
			}
			return left.every(path => right.some(otherPath => this.pathsEqual(path, otherPath)));
		},

		async findExistingPath(paths) {
			for (let path of paths) {
				if (await IOUtils.exists(path)) {
					return path;
				}
			}
			return "";
		},

		async movePrimaryAttachmentFile(sourcePath, desiredPath, diagnostics = []) {
			await IOUtils.makeDirectory(this.getParentPath(desiredPath), { createAncestors: true });
			if (await IOUtils.exists(desiredPath)) {
				let uniquePath = await this.getUniqueDestinationPath(desiredPath);
				if (!uniquePath) {
					diagnostics.push(`主路径移动失败：目标路径已存在且无法生成唯一文件名：${desiredPath}`);
					return "";
				}
				desiredPath = uniquePath;
			}
			try {
				await IOUtils.move(sourcePath, desiredPath);
				return desiredPath;
			}
			catch (e) {
				Zotero.logError(e);
				diagnostics.push(`主路径移动失败：${sourcePath} -> ${desiredPath}；${e.message || e}`);
				return "";
			}
		},

		async getExistingPathWithFileID(path, fileID) {
			if (!path || !(await IOUtils.exists(path))) {
				return "";
			}
			let locator = await this.getWindowsFileID(path, { quiet: true });
			if (locator.fileID && locator.fileID.toLowerCase() === String(fileID || "").toLowerCase()) {
				return path;
			}
			return "";
		},

		getShortcutPathForTargetPath(targetPath) {
			return `${targetPath}.lnk`;
		},

		async ensureShortcutPath(targetPath, shortcutPath, diagnostics = []) {
			await IOUtils.makeDirectory(this.getParentPath(shortcutPath), { createAncestors: true });
			let needsUpdate = true;
			if (await IOUtils.exists(shortcutPath)) {
				let currentTarget = await this.getShortcutTargetPath(shortcutPath, diagnostics);
				needsUpdate = !this.pathsEqual(currentTarget, targetPath);
			}
			if (!needsUpdate) {
				return shortcutPath;
			}
			if (await this.createOrUpdateShortcut(shortcutPath, targetPath, diagnostics)) {
				return shortcutPath;
			}
			return "";
		},

		async createOrUpdateShortcut(shortcutPath, targetPath, diagnostics = []) {
			let outputPath = this.getTempTextPath("zotlink-shortcut");
			let escapedShortcut = this.escapePowerShellSingleQuotedString(shortcutPath);
			let escapedTarget = this.escapePowerShellSingleQuotedString(targetPath);
			let escapedWorkingDir = this.escapePowerShellSingleQuotedString(this.getParentPath(targetPath));
			let escapedOutputPath = this.escapePowerShellSingleQuotedString(outputPath);
			let script = [
				"$ErrorActionPreference = 'Stop'",
				`$shortcutPath = '${escapedShortcut}'`,
				`$targetPath = '${escapedTarget}'`,
				`$workingDir = '${escapedWorkingDir}'`,
				"$shell = New-Object -ComObject WScript.Shell",
				"$shortcut = $shell.CreateShortcut($shortcutPath)",
				"$shortcut.TargetPath = $targetPath",
				"$shortcut.WorkingDirectory = $workingDir",
				"$shortcut.Save()",
				`'OK' | Out-File -LiteralPath '${escapedOutputPath}' -Encoding utf8`
			].join("\r\n");
			try {
				let result = await this.runHiddenPowerShellToOutput(script, outputPath);
				if (await IOUtils.exists(shortcutPath)) {
					return true;
				}
				diagnostics.push(`创建快捷方式失败：${shortcutPath} -> ${targetPath}；${result || "无输出"}`);
				return false;
			}
			catch (e) {
				Zotero.logError(e);
				diagnostics.push(`创建快捷方式失败：${shortcutPath} -> ${targetPath}；${e.message || e}`);
				return false;
			}
			finally {
				try {
					if (await IOUtils.exists(outputPath)) {
						await IOUtils.remove(outputPath);
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
		},

		async getShortcutTargetPath(shortcutPath, diagnostics = []) {
			if (!/\.lnk$/i.test(shortcutPath || "") || !(await IOUtils.exists(shortcutPath))) {
				return "";
			}
			let outputPath = this.getTempTextPath("zotlink-shortcut-target");
			let escapedShortcut = this.escapePowerShellSingleQuotedString(shortcutPath);
			let escapedOutputPath = this.escapePowerShellSingleQuotedString(outputPath);
			let script = [
				"$ErrorActionPreference = 'Stop'",
				"$shell = New-Object -ComObject WScript.Shell",
				`$shortcut = $shell.CreateShortcut('${escapedShortcut}')`,
				`$shortcut.TargetPath | Out-File -LiteralPath '${escapedOutputPath}' -Encoding utf8`
			].join("\r\n");
			try {
				return (await this.runHiddenPowerShellToOutput(script, outputPath)).trim();
			}
			catch (e) {
				Zotero.logError(e);
				diagnostics.push(`读取快捷方式失败：${shortcutPath}；${e.message || e}`);
				return "";
			}
			finally {
				try {
					if (await IOUtils.exists(outputPath)) {
						await IOUtils.remove(outputPath);
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
		},

		async isRemovableMirrorPath(path, primaryPath, fileID) {
			if (/\.lnk$/i.test(path || "")) {
				return true;
			}
			if (this.pathsEqual(path, primaryPath)) {
				return false;
			}
			let locator = await this.getWindowsFileID(path, { quiet: true });
			return Boolean(locator.fileID && locator.fileID.toLowerCase() === String(fileID || "").toLowerCase());
		},

		// Legacy hardlink implementation retained for reference. It is no longer used by the default sync path.
		async ensureHardlinkPath(sourcePath, desiredPath, fileID, diagnostics = []) {
			await IOUtils.makeDirectory(this.getParentPath(desiredPath), { createAncestors: true });
			if (await IOUtils.exists(desiredPath)) {
				let locator = await this.getWindowsFileID(desiredPath, { quiet: true });
				if (locator.fileID && locator.fileID.toLowerCase() === String(fileID).toLowerCase()) {
					return desiredPath;
				}
				desiredPath = await this.getUniqueDestinationPath(desiredPath);
				if (!desiredPath) {
					return "";
				}
			}
			let renamedPath = await this.findPathByFileIDInDirectory(this.getParentPath(desiredPath), fileID);
			if (renamedPath && !this.pathsEqual(renamedPath, sourcePath) && !this.pathsEqual(renamedPath, desiredPath)) {
				try {
					await IOUtils.move(renamedPath, desiredPath);
					return desiredPath;
				}
				catch (e) {
					Zotero.logError(e);
					diagnostics.push(`重命名硬链接失败：${renamedPath} -> ${desiredPath}；${e.message || e}`);
				}
			}
			return this.createHardlinkForAttachment(sourcePath, desiredPath, { diagnostics });
		},

		async findPathByFileIDInDirectory(dir, fileID) {
			if (!dir || !(await IOUtils.exists(dir))) {
				return "";
			}
			let map = await this.buildFileIDMap(dir, { quiet: true });
			return map.get(String(fileID || "").toLowerCase()) || "";
		},

		async createHardlinkForAttachment(sourcePath, linkPath, options = {}) {
			await IOUtils.makeDirectory(this.getParentPath(linkPath), { createAncestors: true });
			let diagnostics = Array.isArray(options.diagnostics) ? options.diagnostics : [];
			let pythonResult = await this.createHardlinkWithPython(sourcePath, linkPath);
			if (await this.isSameFileByID(sourcePath, linkPath)) {
				return linkPath;
			}
			diagnostics.push(`Python os.link 失败：${linkPath} <= ${sourcePath}；${pythonResult}`);
			let diagnostic = `创建硬链接失败：${linkPath} <= ${sourcePath}；${pythonResult}`;
			diagnostics.push(diagnostic);
			Zotero.debug(`ZotLink: ${diagnostic}`, 1);
			return "";
		},

		async isSameFileByID(leftPath, rightPath) {
			if (!leftPath || !rightPath || !(await IOUtils.exists(leftPath)) || !(await IOUtils.exists(rightPath))) {
				return false;
			}
			let left = await this.getWindowsFileID(leftPath, { quiet: true });
			let right = await this.getWindowsFileID(rightPath, { quiet: true });
			return Boolean(left.fileID && right.fileID && left.fileID.toLowerCase() === right.fileID.toLowerCase());
		},

		async createHardlinkWithPython(sourcePath, linkPath) {
			let scriptPath = this.getTempTextPath("zotlink-hardlink").replace(/\.txt$/i, ".py");
			let outputPath = this.getTempTextPath("zotlink-hardlink-output");
			let pythonCode = [
				"import os, sys, traceback",
				"source, link, output = sys.argv[1], sys.argv[2], sys.argv[3]",
				"try:",
				"    os.link(source, link)",
				"    text = 'OK'",
				"except Exception:",
				"    text = traceback.format_exc()",
				"    raise",
				"finally:",
				"    with open(output, 'w', encoding='utf-8') as f:",
				"        f.write(text)"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(pythonCode));
				let result = await this.execDiagnosticCommand("C:\\Windows\\pyw.exe", [
					"-3",
					scriptPath,
					sourcePath,
					linkPath,
					outputPath
				], outputPath);
				return result.diagnostic || "Python 无命令输出";
			}
			catch (e) {
				Zotero.logError(e);
				return this.errorToText(e);
			}
			finally {
				for (let path of [scriptPath, outputPath]) {
					try {
						if (await IOUtils.exists(path)) {
							await IOUtils.remove(path);
						}
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
			}
		},

		async createHardlinkWithPowerShell(sourcePath, linkPath) {
			let escapedSource = this.escapePowerShellSingleQuotedString(sourcePath);
			let escapedLink = this.escapePowerShellSingleQuotedString(linkPath);
			let command = [
				"$ErrorActionPreference = 'Stop'",
				`New-Item -ItemType HardLink -Path '${escapedLink}' -Target '${escapedSource}' | Out-String`
			].join("; ");
			let result = await this.execDiagnosticCommand("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", [
				"-NoProfile",
				"-WindowStyle",
				"Hidden",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				`& { ${command} }`
			]);
			return result.diagnostic || "PowerShell 无命令输出";
		},

		uniquePaths(paths) {
			let seen = new Set();
			let result = [];
			for (let path of paths || []) {
				let key = this.normalizePathForCompare(path);
				if (!key || seen.has(key)) {
					continue;
				}
				seen.add(key);
				result.push(path);
			}
			return result;
		},

		sanitizePathSegment(segment) {
			return String(segment || "")
				.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
				.replace(/[. ]+$/g, "")
				.trim() || "_";
		},

		async moveAttachmentFileInPlace(attachment, destinationDir) {
			if (!attachment.isFileAttachment?.()) {
				return { ok: false, reason: "不是文件附件" };
			}
			if (attachment.libraryID !== Zotero.Libraries.userLibraryID) {
				return { ok: false, reason: "非个人库附件" };
			}

			let sourcePath = attachment.getFilePath();
			if (!sourcePath || !(await IOUtils.exists(sourcePath))) {
				return { ok: false, reason: "源文件不存在" };
			}

			let fileName = PathUtils.filename(sourcePath);
			await IOUtils.makeDirectory(destinationDir, { createAncestors: true });
			let intendedDestinationPath = PathUtils.join(destinationDir, fileName);
			if (this.pathsEqual(sourcePath, intendedDestinationPath)) {
				return { ok: false, reason: "已经在目标目录", indexable: true };
			}

			let destinationPath = await this.getUniqueDestinationPath(intendedDestinationPath);
			if (!destinationPath) {
				return { ok: false, reason: "无法生成唯一目标路径" };
			}

			await IOUtils.move(sourcePath, destinationPath);
			try {
				await this.updateAttachmentLinkedPath(attachment, destinationPath);
				return { ok: true };
			}
			catch (e) {
				Zotero.logError(e);
				try {
					await IOUtils.move(destinationPath, sourcePath);
				}
				catch (rollbackError) {
					Zotero.logError(rollbackError);
					return { ok: false, reason: "更新 Zotero 路径失败且回滚失败" };
				}
				return { ok: false, reason: "Zotero 拒绝更新附件路径" };
			}
		},

		async updateAttachmentLinkedPath(attachment, destinationPath) {
			try {
				attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
				attachment.attachmentPath = destinationPath;
				attachment.setField("title", PathUtils.filename(destinationPath));
				await attachment.saveTx();
				return;
			}
			catch (e) {
				Zotero.logError(e);
			}

			await Zotero.DB.executeTransaction(async () => {
				await Zotero.DB.queryAsync(
					"UPDATE itemAttachments SET linkMode=?, path=? WHERE itemID=?",
					[
						Zotero.Attachments.LINK_MODE_LINKED_FILE,
						destinationPath,
						attachment.id
					]
				);
				attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
				attachment.attachmentPath = destinationPath;
			});
		},

		pathsEqual(a, b) {
			let normalize = path => String(path || "").replace(/\\/g, "/").toLowerCase();
			return normalize(a) === normalize(b);
		},

		async getUniqueDestinationPath(path) {
			if (!(await IOUtils.exists(path))) {
				return path;
			}

			let extension = Zotero.File.getExtension(path);
			let suffix = extension ? "." + extension : "";
			let base = suffix ? path.slice(0, -suffix.length) : path;
			for (let i = 1; i < 100; i++) {
				let candidate = `${base} ${i}${suffix}`;
				if (!(await IOUtils.exists(candidate))) {
					return candidate;
				}
			}
			return "";
		},

		async indexSelectedAttachmentFileIDs() {
			let attachments = this.getSelectedAttachments();
			if (!attachments.length) {
				this.showMoveReport("未找到可记录的文件附件");
				return;
			}

			let indexed = 0;
			let skipped = 0;
			let reasons = new Map();
			let fileIDs = [];
			for (let attachment of attachments) {
				try {
					let result = await this.indexAttachmentFileID(attachment);
					if (result.ok) {
						indexed++;
						if (result.fileID) {
							fileIDs.push(`${result.fileID}  ${result.fileName || ""}`.trim());
						}
					}
					else {
						skipped++;
						this.countReason(reasons, result.reason || "未知原因");
						if (result.detail) {
							this.countReason(reasons, result.detail);
						}
					}
				}
				catch (e) {
					Zotero.logError(e);
					skipped++;
					this.countReason(reasons, e.message || "异常");
				}
			}

			let reasonText = this.formatReasons(reasons);
			let idText = fileIDs.length ? `\n\n已记录机内码：\n${fileIDs.join("\n")}` : "";
			this.showMoveReport(`已记录 ${indexed} 个附件机内码${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}${idText}`);
		},

		async indexAllLibraryAttachmentFileIDs(options = {}) {
			let attachments = await this.getAllUserFileAttachments();
			if (!attachments.length) {
				this.showIndexReport("个人库中未找到可记录机内码的文件附件");
				return;
			}

			let index = this.getAttachmentFileIndex();
			let indexed = 0;
			let skipped = 0;
			let reasons = new Map();
			let startedAt = Date.now();
			let progressWindow = this.createProgressWindow("正在初始化附件机内码", `已处理 0 / ${attachments.length}`);

			for (let i = 0; i < attachments.length; i++) {
				let attachment = attachments[i];
				try {
					let result = await this.indexAttachmentFileID(attachment, {
						quiet: true,
						index,
						save: false
					});
					if (result.ok) {
						indexed++;
					}
					else {
						skipped++;
						this.countReason(reasons, result.reason || "未知原因");
					}
				}
				catch (e) {
					Zotero.logError(e);
					skipped++;
					this.countReason(reasons, e.message || "异常");
				}

				let processed = i + 1;
				if (processed === 1 || processed === attachments.length || processed % 10 === 0) {
					options.onProgress?.({
						processed,
						total: attachments.length,
						indexed,
						skipped
					});
					this.updateProgressWindow(progressWindow, "正在初始化附件机内码", `已处理 ${processed} / ${attachments.length}，已记录 ${indexed}，跳过 ${skipped}`);
				}
			}

			this.setAttachmentFileIndex(index);
			let seconds = Math.round((Date.now() - startedAt) / 1000);
			let reasonText = this.formatReasons(reasons);
			let message = `全库附件机内码初始化完成：共检查 ${attachments.length} 个文件附件，已记录 ${indexed} 个${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。耗时约 ${seconds} 秒。`;
			this.updateProgressWindow(progressWindow, "附件机内码初始化完成", `已记录 ${indexed}，跳过 ${skipped}，耗时约 ${seconds} 秒`, 6000);
			this.showIndexReport(message);
		},

		showIndexReport(message) {
			this.setPref("lastIndexReport", message);
			this.showPreferenceAlert("附件机内码初始化结果", message);
		},

		createProgressWindow(title, message) {
			try {
				let progressWindow = new Zotero.ProgressWindow();
				progressWindow.changeHeadline(title);
				progressWindow.addDescription(message);
				progressWindow.show();
				return progressWindow;
			}
			catch (e) {
				Zotero.logError(e);
				return null;
			}
		},

		updateProgressWindow(progressWindow, title, message, closeAfter = null) {
			if (!progressWindow) {
				return;
			}
			try {
				progressWindow.changeHeadline(title);
				progressWindow.addDescription(message);
				if (closeAfter) {
					progressWindow.startCloseTimer(closeAfter);
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		async getAllUserFileAttachments() {
			let rows = await Zotero.DB.queryAsync(
				"SELECT I.itemID FROM items I JOIN itemAttachments IA ON I.itemID=IA.itemID WHERE I.libraryID=? AND I.itemTypeID=(SELECT itemTypeID FROM itemTypes WHERE typeName='attachment')",
				[Zotero.Libraries.userLibraryID]
			);
			let attachments = [];
			for (let row of rows) {
				try {
					let itemID = row.itemID || row.itemid || row[0];
					let item = await Zotero.Items.getAsync(itemID);
					if (item?.isFileAttachment?.()) {
						attachments.push(item);
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			return attachments;
		},

		async indexAttachmentFileID(attachment, options = {}) {
			if (!attachment?.isFileAttachment?.()) {
				return { ok: false, reason: "不是文件附件" };
			}

			let path = attachment.getFilePath();
			if (!path || !(await IOUtils.exists(path))) {
				return { ok: false, reason: "源文件不存在" };
			}

			let locator = await this.getWindowsFileID(path, { quiet: Boolean(options.quiet) });
			if (!locator.fileID) {
				return {
					ok: false,
					reason: "无法读取机内码",
					detail: locator.diagnostics
				};
			}

			let index = options.index || this.getAttachmentFileIndex();
			let existing = this.normalizeAttachmentIndexRecord(attachment, index[attachment.key]);
			index[attachment.key] = {
				...existing,
				itemID: attachment.id,
				key: attachment.key,
				fileID: locator.fileID,
				path,
				primaryPath: path,
				shortcutPaths: existing.shortcutPaths || [],
				hardlinkPaths: existing.hardlinkPaths || [],
				fileName: PathUtils.filename(path),
				updatedAt: new Date().toISOString()
			};
			if (options.save !== false) {
				this.setAttachmentFileIndex(index);
			}
			return {
				ok: true,
				fileID: locator.fileID,
				fileName: PathUtils.filename(path)
			};
		},

		getAttachmentFileIndex() {
			let raw = this.getPref("attachmentFileIndex", "{}");
			try {
				let index = JSON.parse(raw);
				return index && typeof index === "object" && !Array.isArray(index) ? index : {};
			}
			catch (e) {
				return {};
			}
		},

		setAttachmentFileIndex(index) {
			this.setPref("attachmentFileIndex", JSON.stringify(index));
		},

		normalizeAttachmentIndexRecord(attachment, record = {}) {
			record = record && typeof record === "object" && !Array.isArray(record) ? record : {};
			let currentPath = attachment?.getFilePath?.() || "";
			let primaryPath = record.primaryPath || record.path || currentPath;
			let hardlinkPaths = Array.isArray(record.hardlinkPaths) ? record.hardlinkPaths : [];
			let shortcutPaths = Array.isArray(record.shortcutPaths) ? record.shortcutPaths : [];
			return {
				...record,
				itemID: record.itemID || attachment?.id,
				key: record.key || attachment?.key,
				path: primaryPath,
				primaryPath,
				shortcutPaths: this.uniquePaths(shortcutPaths).filter(path => !this.pathsEqual(path, primaryPath)),
				hardlinkPaths: this.uniquePaths(hardlinkPaths).filter(path => !this.pathsEqual(path, primaryPath))
			};
		},

		async getWindowsFileID(path, options = {}) {
			if (options.quiet) {
				return this.getWindowsFileIDQuiet(path);
			}

			let escapedPath = this.escapePowerShellSingleQuotedString(path);
			let outputPath = this.getTempTextPath("zotlink-fileid");
			let escapedOutputPath = this.escapePowerShellSingleQuotedString(outputPath);
			let pythonCode = this.getPythonFileIDScript();
			let commands = [
				["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", [
					"-NoProfile",
					"-WindowStyle",
					"Hidden",
					"-ExecutionPolicy",
					"Bypass",
					"-Command",
					`& { fsutil file queryfileid '${escapedPath}' 2>&1 | Out-File -LiteralPath '${escapedOutputPath}' -Encoding utf8 }`
				], outputPath],
				["C:\\Windows\\System32\\fsutil.exe", ["file", "queryfileid", path]],
				["C:\\Windows\\Sysnative\\fsutil.exe", ["file", "queryfileid", path]],
				["C:\\Windows\\py.exe", ["-3", "-c", pythonCode, path]],
				["C:\\Windows\\System32\\cmd.exe", ["/d", "/s", "/c", `fsutil file queryfileid "${path.replace(/"/g, '\\"')}"`]],
				["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", [
					"-NoProfile",
					"-WindowStyle",
					"Hidden",
					"-ExecutionPolicy",
					"Bypass",
					"-Command",
					`fsutil file queryfileid '${escapedPath}'`
				]]
			];
			let diagnostics = [];
			for (let [command, args, outputFile] of commands) {
				let result = await this.execFileIDCommand(command, args, outputFile);
				diagnostics.push(result.diagnostic);
				if (result.fileID) {
					return {
						fileID: result.fileID,
						diagnostics: diagnostics.join("\n\n")
					};
				}
			}
			return {
				fileID: "",
				diagnostics: diagnostics.join("\n\n")
			};
		},

		async getWindowsFileIDQuiet(path) {
			let outputPath = this.getTempTextPath("zotlink-fileid");
			let escapedPath = this.escapePowerShellSingleQuotedString(path);
			let escapedOutputPath = this.escapePowerShellSingleQuotedString(outputPath);
			let script = `fsutil file queryfileid '${escapedPath}' 2>&1 | Out-File -LiteralPath '${escapedOutputPath}' -Encoding utf8`;
			try {
				let text = await this.runHiddenPowerShellToOutput(script, outputPath);
				let match = text.match(/FILEID\s+([^\s]+)/i) || text.match(/(0x[0-9a-f]+)/i);
				return {
					fileID: match ? match[1].toLowerCase() : "",
					diagnostics: text
				};
			}
			catch (e) {
				Zotero.logError(e);
				return {
					fileID: "",
					diagnostics: this.errorToText(e)
				};
			}
		},

		getPythonFileIDScript() {
			return `
import ctypes
import sys

path = sys.argv[1]
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

GENERIC_READ = 0x80000000
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
FILE_SHARE_DELETE = 0x00000004
OPEN_EXISTING = 3
FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

class FILETIME(ctypes.Structure):
    _fields_ = [
        ("dwLowDateTime", ctypes.c_uint32),
        ("dwHighDateTime", ctypes.c_uint32),
    ]

class BY_HANDLE_FILE_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("dwFileAttributes", ctypes.c_uint32),
        ("ftCreationTime", FILETIME),
        ("ftLastAccessTime", FILETIME),
        ("ftLastWriteTime", FILETIME),
        ("dwVolumeSerialNumber", ctypes.c_uint32),
        ("nFileSizeHigh", ctypes.c_uint32),
        ("nFileSizeLow", ctypes.c_uint32),
        ("nNumberOfLinks", ctypes.c_uint32),
        ("nFileIndexHigh", ctypes.c_uint32),
        ("nFileIndexLow", ctypes.c_uint32),
    ]

kernel32.CreateFileW.argtypes = [
    ctypes.c_wchar_p,
    ctypes.c_uint32,
    ctypes.c_uint32,
    ctypes.c_void_p,
    ctypes.c_uint32,
    ctypes.c_uint32,
    ctypes.c_void_p,
]
kernel32.CreateFileW.restype = ctypes.c_void_p
kernel32.GetFileInformationByHandle.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(BY_HANDLE_FILE_INFORMATION),
]
kernel32.GetFileInformationByHandle.restype = ctypes.c_int
kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
kernel32.CloseHandle.restype = ctypes.c_int

handle = kernel32.CreateFileW(
    path,
    0,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    None,
    OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS,
    None,
)
if handle == INVALID_HANDLE_VALUE:
    raise ctypes.WinError(ctypes.get_last_error())

try:
    info = BY_HANDLE_FILE_INFORMATION()
    if not kernel32.GetFileInformationByHandle(handle, ctypes.byref(info)):
        raise ctypes.WinError(ctypes.get_last_error())
    file_id = (info.nFileIndexHigh << 32) | info.nFileIndexLow
    print("FILEID 0x%08x:0x%016x" % (info.dwVolumeSerialNumber, file_id))
finally:
    kernel32.CloseHandle(handle)
`.trim();
		},

		escapePowerShellSingleQuotedString(value) {
			return String(value || "").replace(/'/g, "''");
		},

		getTempTextPath(prefix) {
			let name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
			return PathUtils.join(PathUtils.tempDir, name);
		},

		async runHiddenPowerShellToOutput(script, outputPath) {
			let psPath = this.getTempTextPath("zotlink-script").replace(/\.txt$/i, ".ps1");
			let vbsPath = this.getTempTextPath("zotlink-runner").replace(/\.txt$/i, ".vbs");
			let powerShellPath = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
			let wscriptPath = "C:\\Windows\\System32\\wscript.exe";
			let vbs = [
				"Set shell = CreateObject(\"WScript.Shell\")",
				`command = "${this.escapeVBScriptString(powerShellPath)} -NoProfile -ExecutionPolicy Bypass -File ""${this.escapeVBScriptString(psPath)}"""`,
				"exitCode = shell.Run(command, 0, True)",
				"WScript.Quit exitCode"
			].join("\r\n");

			try {
				await IOUtils.write(psPath, this.encodeUTF16LEWithBOM(script));
				await IOUtils.write(vbsPath, new TextEncoder().encode(vbs));
				await Zotero.Utilities.Internal.exec(wscriptPath, [vbsPath]);
				return await this.readCommandOutputFile(outputPath, "");
			}
			finally {
				for (let path of [psPath, vbsPath]) {
					try {
						if (await IOUtils.exists(path)) {
							await IOUtils.remove(path);
						}
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
			}
		},

		async runHiddenCommandToOutput(commandLine, outputPath) {
			let vbsPath = this.getTempTextPath("zotlink-runner").replace(/\.txt$/i, ".vbs");
			let wscriptPath = "C:\\Windows\\System32\\wscript.exe";
			let vbs = [
				"Set shell = CreateObject(\"WScript.Shell\")",
				`command = "${this.escapeVBScriptString(commandLine)}"`,
				"exitCode = shell.Run(command, 0, True)",
				"WScript.Quit exitCode"
			].join("\r\n");

			try {
				if (outputPath && await IOUtils.exists(outputPath)) {
					await IOUtils.remove(outputPath);
				}
				await IOUtils.write(vbsPath, new TextEncoder().encode(vbs));
				await Zotero.Utilities.Internal.exec(wscriptPath, [vbsPath]);
				return await this.readCommandOutputFile(outputPath, "");
			}
			finally {
				try {
					if (await IOUtils.exists(vbsPath)) {
						await IOUtils.remove(vbsPath);
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
		},

		escapeVBScriptString(value) {
			return String(value || "").replace(/"/g, "\"\"");
		},

		quoteCommandArg(value) {
			return `"${String(value || "").replace(/"/g, '""')}"`;
		},

		encodeUTF16LEWithBOM(text) {
			text = String(text || "");
			let bytes = new Uint8Array(2 + text.length * 2);
			bytes[0] = 0xFF;
			bytes[1] = 0xFE;
			for (let i = 0; i < text.length; i++) {
				let code = text.charCodeAt(i);
				bytes[2 + i * 2] = code & 0xFF;
				bytes[3 + i * 2] = code >> 8;
			}
			return bytes;
		},

		async execFileIDCommand(command, args, outputFile = "") {
			let label = `${command} ${args.map(arg => JSON.stringify(arg)).join(" ")}`;
			try {
				if (outputFile && await IOUtils.exists(outputFile)) {
					await IOUtils.remove(outputFile);
				}
				let output = await Zotero.Utilities.Internal.exec(command, args);
				let text = outputFile ? await this.readCommandOutputFile(outputFile, output) : this.execOutputToText(output);
				let match = text.match(/FILEID\s+([^\s]+)/i);
				if (match) {
					return {
						fileID: match[1].toLowerCase(),
						diagnostic: `[OK] ${label}\n${this.truncateDiagnostic(text)}`
					};
				}
				match = text.match(/0x[0-9a-f]+/i);
				return {
					fileID: match ? match[0].toLowerCase() : "",
					diagnostic: `[${match ? "OK" : "NO MATCH"}] ${label}\n${this.truncateDiagnostic(text)}`
				};
			}
			catch (e) {
				Zotero.logError(e);
				return {
					fileID: "",
					diagnostic: `[ERROR] ${label}\n${this.truncateDiagnostic(this.errorToText(e))}`
				};
			}
		},

		async execDiagnosticCommand(command, args, outputFile = "") {
			let label = `${command} ${args.map(arg => JSON.stringify(arg)).join(" ")}`;
			try {
				if (outputFile && await IOUtils.exists(outputFile)) {
					await IOUtils.remove(outputFile);
				}
				let output = await Zotero.Utilities.Internal.exec(command, args);
				let text = outputFile ? await this.readCommandOutputFile(outputFile, output) : this.execOutputToText(output);
				return {
					ok: true,
					diagnostic: `[OK] ${label}\n${this.truncateDiagnostic(text)}`
				};
			}
			catch (e) {
				Zotero.logError(e);
				let text = outputFile ? await this.readCommandOutputFile(outputFile, "") : "";
				return {
					ok: false,
					diagnostic: `[ERROR] ${label}\n${this.truncateDiagnostic([this.errorToText(e), text].filter(Boolean).join("\n"))}`
				};
			}
		},

		async readCommandOutputFile(outputFile, execOutput) {
			if (outputFile && await IOUtils.exists(outputFile)) {
				try {
					let bytes = await IOUtils.read(outputFile);
					let text = this.decodeTextBytes(bytes);
					await IOUtils.remove(outputFile);
					return text;
				}
				catch (e) {
					Zotero.logError(e);
					return this.execOutputToText(execOutput) + "\n[failed to read output file] " + this.errorToText(e);
				}
			}
			return this.execOutputToText(execOutput);
		},

		truncateDiagnostic(text) {
			text = String(text || "").trim();
			if (!text) {
				return "(empty output)";
			}
			return text;
		},

		decodeTextBytes(bytes) {
			if (!bytes) {
				return "";
			}
			if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
				return new TextDecoder("utf-16le").decode(bytes);
			}
			if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
				return new TextDecoder("utf-16be").decode(bytes);
			}
			return new TextDecoder("utf-8").decode(bytes);
		},

		async writeTextReport(prefix, text) {
			let path = this.getTempTextPath(prefix);
			let bytes = new TextEncoder().encode(String(text || ""));
			await IOUtils.write(path, bytes);
			return path;
		},

		errorToText(error) {
			if (!error) {
				return "";
			}
			return [
				error.message,
				error.name,
				error.result,
				error.stack,
				JSON.stringify(error, Object.getOwnPropertyNames(error))
			].filter(Boolean).join("\n");
		},

		execOutputToText(output) {
			if (typeof output === "string") {
				return output;
			}
			if (Array.isArray(output)) {
				return output.join("\n");
			}
			if (output && typeof output === "object") {
				return [
					output.stdout,
					output.stderr,
					output.output,
					JSON.stringify(output)
				].filter(Boolean).join("\n");
			}
			return String(output || "");
		},

		async repairSelectedAttachmentLinksByFileID() {
			let root = this.getAttachmentMoveRoot();
			if (!root || !(await IOUtils.exists(root))) {
				this.showMoveReport("附件顶层路径不存在，无法扫描修复");
				return;
			}

			let attachments = this.getSelectedAttachments();
			if (!attachments.length) {
				this.showMoveReport("未找到可修复的文件附件");
				return;
			}

			let repaired = 0;
			let skipped = 0;
			let reasons = new Map();

			for (let attachment of attachments) {
				try {
					let result = await this.repairAttachmentLinkByFileID(attachment, { silent: false });
					if (result.ok) {
						repaired++;
					}
					else {
						this.countReason(reasons, result.reason || "未知原因");
						skipped++;
					}
				}
				catch (e) {
					Zotero.logError(e);
					this.countReason(reasons, e.message || "异常");
					skipped++;
				}
			}

			Zotero.getActiveZoteroPane().itemsView?.refreshAndMaintainSelection?.();
			let reasonText = this.formatReasons(reasons);
			this.showMoveReport(`已修复 ${repaired} 个附件链接${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}`);
		},

		async repairAttachmentLinkByFileID(attachment, options = {}) {
			let root = this.getAttachmentMoveRoot();
			if (!root || !(await IOUtils.exists(root))) {
				return { ok: false, reason: "附件顶层路径不存在" };
			}

			if (!attachment?.isFileAttachment?.()) {
				return { ok: false, reason: "不是文件附件" };
			}

			let currentPath = attachment.getFilePath();
			if (currentPath && await IOUtils.exists(currentPath)) {
				return { ok: false, reason: "当前链接未丢失" };
			}

			let record = this.normalizeAttachmentIndexRecord(attachment, this.getAttachmentFileIndex()[attachment.key]);
			if (!record?.fileID) {
				return { ok: false, reason: "没有已记录机内码" };
			}

			let fileID = record.fileID.toLowerCase();
			let foundPath = await this.findFileByRecordedID(fileID, root, record, options);
			if (!foundPath) {
				return { ok: false, reason: "未在顶层目录找到匹配文件" };
			}

			await this.updateAttachmentLinkedPath(attachment, foundPath);
			this.updateAttachmentFileIndexPath(attachment, record, foundPath);
			Zotero.getActiveZoteroPane()?.itemsView?.refreshAndMaintainSelection?.();
			if (!options.silent) {
				this.showStatus("已自动修复附件链接");
			}
			return { ok: true, path: foundPath };
		},

		async findFileByRecordedID(fileID, root, record, options = {}) {
			let candidateDirs = [];
			for (let path of [record.primaryPath, record.path, ...(record.shortcutPaths || []), ...(record.hardlinkPaths || [])]) {
				let dir = this.getParentPath(path);
				if (dir) {
					candidateDirs.push(dir);
				}
			}
			candidateDirs.push(root);

			let seen = new Set();
			for (let dir of candidateDirs) {
				if (!dir || seen.has(dir.toLowerCase()) || !(await IOUtils.exists(dir))) {
					continue;
				}
				seen.add(dir.toLowerCase());
				let map = await this.buildFileIDMap(dir, { quiet: true, useCache: dir === root });
				let foundPath = map.get(fileID);
				if (foundPath) {
					return foundPath;
				}
			}
			return "";
		},

		updateAttachmentFileIndexPath(attachment, record, path) {
			let index = this.getAttachmentFileIndex();
			record = this.normalizeAttachmentIndexRecord(attachment, record);
			index[attachment.key] = {
				...record,
				itemID: attachment.id,
				key: attachment.key,
				path,
				primaryPath: path,
				shortcutPaths: (record.shortcutPaths || []).filter(shortcutPath => !this.pathsEqual(shortcutPath, path)),
				hardlinkPaths: [],
				fileName: PathUtils.filename(path),
				updatedAt: new Date().toISOString()
			};
			this.setAttachmentFileIndex(index);
		},

		getParentPath(path) {
			path = String(path || "");
			let index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
			return index > 0 ? path.slice(0, index) : "";
		},

		async buildFileIDMap(root, options = {}) {
			let cache = this._fileIDMapCache;
			if (options.useCache && cache?.root === root && Date.now() - cache.createdAt < 60000) {
				return cache.map;
			}

			let outputPath = this.getTempTextPath("zotlink-fileid-map");
			let escapedRoot = this.escapePowerShellSingleQuotedString(root);
			let escapedOutputPath = this.escapePowerShellSingleQuotedString(outputPath);
			let script = `$out = '${escapedOutputPath}'
Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath '${escapedRoot}' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $p = $_.FullName
    $r = fsutil file queryfileid $p 2>&1
    $t = ($r | Out-String).Trim()
    if ($t -match '(0x[0-9a-fA-F]+)') {
        Add-Content -LiteralPath $out -Encoding utf8 -Value ($matches[1].ToLowerInvariant() + [char]9 + $p)
    }
}`;
			let text;
			try {
				text = await this.runHiddenPowerShellToOutput(script, outputPath);
			}
			catch (e) {
				Zotero.logError(e);
				throw new Error("扫描顶层目录机内码失败：" + this.errorToText(e));
			}

			let fileIDs = new Map();
			for (let line of String(text || "").split(/\r?\n/)) {
				line = line.trim();
				if (!line) {
					continue;
				}
				let [fileID, ...pathParts] = line.split("\t");
				let filePath = pathParts.join("\t");
				if (fileID && filePath && !fileIDs.has(fileID.toLowerCase())) {
					fileIDs.set(fileID.toLowerCase(), filePath);
				}
			}
			if (options.useCache) {
				this._fileIDMapCache = {
					root,
					createdAt: Date.now(),
					map: fileIDs
				};
			}
			return fileIDs;
		},

		async listFilesRecursive(root) {
			let results = [];
			let stack = [root];
			while (stack.length) {
				let dir = stack.pop();
				let children;
				try {
					children = await IOUtils.getChildren(dir);
				}
				catch (e) {
					Zotero.logError(e);
					continue;
				}

				for (let child of children) {
					let stat;
					try {
						stat = await IOUtils.stat(child);
					}
					catch (e) {
						continue;
					}
					if (stat.type === "directory") {
						stack.push(child);
					}
					else if (stat.type === "regular") {
						results.push(child);
					}
				}
			}
			return results;
		},

		showStatus(message, closeAfter = 1200) {
			try {
				let progressWindow = new Zotero.ProgressWindow();
				progressWindow.changeHeadline("ZotLink");
				progressWindow.addDescription(message);
				progressWindow.show();
				progressWindow.startCloseTimer(closeAfter);
			}
			catch (e) {
				Zotero.debug("ZotLink: " + message);
			}
		}
	};
})();
