"use strict";

(function () {
	const LFServices = typeof Services !== "undefined" ? Services : null;

	const PREF_PREFIX = "extensions.zotlink.";
	const PLUGIN_ID = "zotlink@local";
	const ITEM_MENU_ID = "zotlink-item-menu";
	const COLLECTION_MENU_ID = "zotlink-collection-menu";
	const MOVE_SHORTCUT_KEY_ID = "zotlink-move-shortcut-key";
	const COPY_LINK_SHORTCUT_KEY_ID = "zotlink-copy-link-shortcut-key";
	const COPY_OBSIDIAN_LINK_SHORTCUT_KEY_ID = "zotlink-copy-obsidian-link-shortcut-key";
	const PLUGIN_NAME = "ZotLink";
	const DEFAULT_ATTACHMENT_MOVE_ROOT = "D:\\OneDrive\\Zotero";
	const MAX_CITATION_PATH_LENGTH = 280;
	const FTL_FILE = "zotlink.ftl";
	const ARTICLE_HISTORY_INFO_ROWS = [
		{ key: "Received", rowID: "zotlink-received-date-row", l10nID: "zotlink-info-row-received-date" },
		{ key: "Revised", rowID: "zotlink-revised-date-row", l10nID: "zotlink-info-row-revised-date" },
		{ key: "Accepted", rowID: "zotlink-accepted-date-row", l10nID: "zotlink-info-row-accepted-date" },
		{ key: "Online", rowID: "zotlink-online-date-row", l10nID: "zotlink-info-row-online-date" }
	];

	Zotero.ZotLink = {
		_menuElements: [],
		_shortcutElements: [],
		_registeredInfoRows: new Set(),
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
		_pendingCollectionPathChanges: new Map(),
		_pendingAutomaticPDFOperationItemIDs: new Set(),
		_citationMetadataByItemID: new Map(),
		_automaticCitationRenameHandledAttachmentIDs: new Set(),
		_attachmentFileIDTimer: null,
		_attachmentFileIDRetryCounts: new Map(),
		_collectionPathSnapshot: new Map(),
		_lastCollectionPathChangeSignature: "",
		_lastCollectionPathChangeAt: 0,
		_pendingMoveRetryTimer: null,
		_retryingPendingMoves: false,
		_pendingEmptyDirectoryCleanupPaths: new Set(),
		_emptyDirectoryCleanupTimers: new Set(),
		_collectionDragHandlers: new Map(),
		_collectionPDFImportRunning: false,
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
				this.runStartupStep("insertLocalization", () => this.insertLocalization(win));
				this.runStartupStep("registerCollectionMenu", () => this.registerCollectionMenu(win));
				this.runStartupStep("registerAttachmentOpenHooks", () => this.registerAttachmentOpenHooks(win));
				this.runStartupStep("registerCollectionDragHooks", () => this.registerCollectionDragHooks(win));
			}
			this.runStartupStep("registerArticleHistoryInfoRows", () => this.registerArticleHistoryInfoRows());
			this.runStartupStep("registerAttachmentFileIDObserver", () => this.registerAttachmentFileIDObserver());
			this.runStartupStep("schedulePendingAttachmentMoveRetry", () => this.schedulePendingAttachmentMoveRetry(3000));
			Zotero.debug("ZotLink started");
		},

		async shutdown() {
			this.clearPendingAttachmentMoveRetryTimer();
			this.clearEmptyDirectoryCleanupTimers();
			this._citationMetadataByItemID.clear();
			this._automaticCitationRenameHandledAttachmentIDs.clear();
			this.unregisterArticleHistoryInfoRows();
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
			this.runStartupStep("insertLocalization", () => this.insertLocalization(win));
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
			let collectionPathSnapshot = null;
			let collectionPathSnapshotPromise = null;
			let collectionDragCandidate = false;
			let collectionDragRootID = null;
			let timer = null;
			let dragCompleted = false;
			let captureSnapshot = event => {
				snapshot = this.getSelectedItemCollectionSnapshot(win);
				collectionDragCandidate = this.isLikelyCollectionDragEvent(event, win, snapshot);
				collectionDragRootID = collectionDragCandidate
					? this.getSelectedCollectionID(win?.ZoteroPane || Zotero.getActiveZoteroPane?.())
					: null;
				let capturedCollectionRootID = collectionDragRootID;
				collectionPathSnapshot = null;
				collectionPathSnapshotPromise = (collectionDragCandidate
					? this.captureCollectionDragStartSnapshot(capturedCollectionRootID)
					: Promise.resolve(new Map()))
					.then(snapshot => {
						collectionPathSnapshot = snapshot;
						return snapshot;
					})
					.catch(e => {
						Zotero.logError(e);
						collectionPathSnapshot = capturedCollectionRootID
							? this.buildCollectionPathSnapshotForCollectionIDs([capturedCollectionRootID])
							: this.buildCollectionPathSnapshot();
						return collectionPathSnapshot;
					});
				dragCompleted = false;
			};
			let completeDrag = source => {
				if (dragCompleted) {
					return;
				}
				dragCompleted = true;
				let dragSnapshot = snapshot || this.getSelectedItemCollectionSnapshot(win);
				let dragCollectionPathSnapshot = collectionPathSnapshot || null;
				let dragCollectionPathSnapshotPromise = collectionPathSnapshotPromise || null;
				let shouldCheckCollectionPath = Boolean(collectionDragCandidate);
				let dragCollectionRootID = collectionDragRootID || null;
				snapshot = null;
				collectionPathSnapshot = null;
				collectionPathSnapshotPromise = null;
				collectionDragCandidate = false;
				collectionDragRootID = null;
				if (timer) {
					win.clearTimeout(timer);
				}
				timer = win.setTimeout(async () => {
					timer = null;
					if (shouldCheckCollectionPath) {
						dragCollectionPathSnapshot = dragCollectionPathSnapshot
							|| (dragCollectionPathSnapshotPromise ? await dragCollectionPathSnapshotPromise : null);
						this.checkCollectionPathDragSnapshot(dragCollectionPathSnapshot, source, dragCollectionRootID).catch(e => Zotero.logError(e));
					}
					if (dragSnapshot.size) {
						this.checkCollectionDragSnapshot(dragSnapshot, source).catch(e => Zotero.logError(e));
					}
				}, 500);
			};
			let onDrop = () => {
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

		isLikelyCollectionDragEvent(event, win, itemSnapshot) {
			let target = event?.target;
			let itemCount = itemSnapshot?.size || 0;
			for (let node = target; node && node !== win?.document; node = node.parentNode) {
				let text = `${node.id || ""} ${node.className || ""} ${node.getAttribute?.("role") || ""} ${node.getAttribute?.("data-l10n-id") || ""}`;
				if (/collection/i.test(text) && !/item/i.test(text)) {
					return true;
				}
			}
			return itemCount === 0;
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
				runAutomaticPDFOperations: false,
				preferredPrimaryCollectionIDs,
				removedCollectionIDs
			});
		},

		async checkCollectionPathDragSnapshot(previous, source, rootCollectionID = null) {
			previous = previous instanceof Map ? previous : new Map();
			let current = await this.buildCollectionPathSnapshotAsync(rootCollectionID);
			let inferredCurrent = null;
			if (rootCollectionID) {
				let inferredPath = await this.getCollectionPathByIDAsync(rootCollectionID);
				if (inferredPath.length) {
					let collection = Zotero.Collections.get(Number(rootCollectionID));
					inferredCurrent = {
						path: inferredPath,
						name: collection?.name || inferredPath[inferredPath.length - 1] || "",
						parentID: this.getCollectionParentIDValue(collection)
					};
				}
			}
			if (rootCollectionID && inferredCurrent && !current.has(Number(rootCollectionID))) {
				current.set(Number(rootCollectionID), inferredCurrent);
			}
			if (!rootCollectionID) {
				this._collectionPathSnapshot = current;
			}
			let changes = this.getCollectionPathChanges(previous, current);
			if (!changes.length) {
				Zotero.debug(`ZotLink: collection path drag ended (${source}), no path changes`);
				await this.writeCollectionPathDiagnostic({
					source: `拖拽${source}`,
					previousSize: previous.size,
					currentSize: current.size,
					changes: [],
					folderStats: null,
					itemIDs: [],
					previousSnapshot: previous,
					currentSnapshot: current,
					rootCollectionID,
					inferredCurrent
				});
				let currentRecord = current.get(Number(rootCollectionID)) || inferredCurrent;
				let collectionName = currentRecord?.name || "所选分类";
				this.showStatus(`“${collectionName}”的位置没有变化，无需移动文件夹。`, 4000);
				return;
			}
			let summary = this.formatCollectionPathChangesForUser(changes);
			await this.processCollectionPathChanges(changes, `拖拽${source}`, { pathSummary: summary });
		},

		async captureCollectionDragStartSnapshot(rootCollectionID) {
			rootCollectionID = Number(rootCollectionID) || 0;
			let snapshot = await this.buildCollectionPathSnapshotAsync(rootCollectionID);
			let record = rootCollectionID ? snapshot.get(rootCollectionID) : null;
			if (rootCollectionID && !record) {
				let path = await this.getCollectionPathByIDAsync(rootCollectionID);
				if (path.length) {
					let collection = Zotero.Collections.get(rootCollectionID);
					record = {
						path,
						name: collection?.name || path[path.length - 1] || "",
						parentID: this.getCollectionParentIDValue(collection)
					};
					snapshot.set(rootCollectionID, record);
				}
			}
			return snapshot;
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
						await this.repairAttachmentLinkByFileID(item, {
							silent: true,
							notifyOutsideRoot: true
						});
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

			this._collectionPathSnapshot = this.buildCollectionPathSnapshot();
			this.buildCollectionPathSnapshotAsync()
				.then(snapshot => {
					if (snapshot?.size) {
						this._collectionPathSnapshot = snapshot;
					}
				})
				.catch(e => Zotero.logError(e));
			this._attachmentFileIDObserver = {
				notify: (event, type, ids, extraData) => {
					if (type === "collection") {
						this.handleCollectionStructureChange(event, ids, extraData).catch(e => Zotero.logError(e));
					}
					let itemIDs = this.getNotifierItemIDs(event, type, ids, extraData);
					this.scheduleAttachmentFileIDIndexing(itemIDs, {
						delay: type === "collection-item" ? 750 : undefined,
						runAutomaticPDFOperations: type === "item" && event === "add"
					});
				}
			};
			this._attachmentFileIDNotifierID = Zotero.Notifier.registerObserver(
				this._attachmentFileIDObserver,
				["item", "collection", "collection-item"],
				this._pluginID + "-attachment-file-id"
			);
		},

		buildCollectionPathSnapshot() {
			let snapshot = new Map();
			let collections = Zotero.Collections.getByLibrary
				? Zotero.Collections.getByLibrary(Zotero.Libraries.userLibraryID)
				: [];
			for (let collection of collections || []) {
				if (!collection?.id) {
					continue;
				}
				let path = this.getCollectionPathByID(collection.id);
				if (path.length) {
					snapshot.set(Number(collection.id), {
						path,
						name: collection.name || "",
						parentID: this.getCollectionParentIDValue(collection)
					});
				}
			}
			return snapshot;
		},

		async buildCollectionPathSnapshotAsync(rootCollectionID = null) {
			try {
				let rows = await Zotero.DB.queryAsync(
					"SELECT C.collectionID AS collectionID, C.collectionName AS collectionName, C.parentCollectionID AS parentCollectionID FROM collections C LEFT JOIN deletedCollections DC ON C.collectionID=DC.collectionID WHERE C.libraryID=? AND DC.collectionID IS NULL",
					[Zotero.Libraries.userLibraryID]
				);
				let byID = this.buildCollectionRecordMap(rows);

				let snapshot = new Map();
				for (let record of byID.values()) {
					if (rootCollectionID && !this.collectionRecordIsInSubtree(record.id, rootCollectionID, byID)) {
						continue;
					}
					let path = this.getCollectionPathFromRecordMap(record.id, byID);
					if (path.length) {
						snapshot.set(Number(record.id), {
							path,
							name: record.name || path[path.length - 1] || "",
							parentID: record.parentID || null
						});
					}
				}
				return snapshot;
			}
			catch (e) {
				Zotero.logError(e);
				return this.buildCollectionPathSnapshot();
			}
		},

		buildCollectionRecordMap(rows) {
			let byID = new Map();
			for (let row of rows || []) {
				let id = Number(row.collectionID || row.collectionid || row[0]);
				if (!id) {
					continue;
				}
				let parentID = Number(row.parentCollectionID || row.parentcollectionid || row.parentCollectionId || row[2] || 0);
				byID.set(id, {
					id,
					name: row.collectionName || row.collectionname || row[1] || "",
					parentID: Number.isInteger(parentID) && parentID > 0 ? parentID : null
				});
			}
			return byID;
		},

		collectionRecordIsInSubtree(collectionID, rootCollectionID, byID) {
			collectionID = Number(collectionID) || 0;
			rootCollectionID = Number(rootCollectionID) || 0;
			if (!collectionID || !rootCollectionID) {
				return false;
			}
			let current = byID?.get?.(collectionID);
			let guard = new Set();
			while (current?.id && !guard.has(Number(current.id))) {
				if (Number(current.id) === rootCollectionID) {
					return true;
				}
				guard.add(Number(current.id));
				let parentID = current.parentID ? Number(current.parentID) : null;
				current = parentID ? byID.get(parentID) : null;
			}
			return false;
		},

		buildCollectionPathSnapshotForCollectionIDs(collectionIDs) {
			let ids = new Set((collectionIDs || [])
				.map(id => Number(id))
				.filter(id => Number.isInteger(id) && id > 0));
			let snapshot = new Map();
			for (let id of ids) {
				let path = this.getCollectionPathByID(id);
				if (path.length) {
					let collection = Zotero.Collections.get(id);
					snapshot.set(id, {
						path,
						name: collection?.name || path[path.length - 1] || "",
						parentID: this.getCollectionParentIDValue(collection)
					});
				}
			}
			return snapshot;
		},

		getCollectionPathFromRecordMap(collectionID, byID) {
			let names = [];
			let current = byID?.get?.(Number(collectionID));
			let guard = new Set();
			while (current?.id && !guard.has(Number(current.id))) {
				guard.add(Number(current.id));
				if (current.name) {
					names.unshift(this.sanitizePathSegment(current.name));
				}
				let parentID = current.parentID ? Number(current.parentID) : null;
				current = parentID ? byID.get(parentID) : null;
			}
			return names.filter(Boolean);
		},

		async handleCollectionStructureChange(event) {
			if (!["add", "modify", "delete"].includes(event)) {
				return;
			}

			let previous = this._collectionPathSnapshot || new Map();
			let current = await this.buildCollectionPathSnapshotAsync();
			this._collectionPathSnapshot = current;
			if (event !== "modify" || !previous.size) {
				return;
			}

			let changes = this.getCollectionPathChanges(previous, current);
			if (!changes.length) {
				return;
			}
			await this.processCollectionPathChanges(changes, "notifier", {
				pathSummary: this.formatCollectionPathChangesForUser(changes)
			});
		},

		getCollectionPathChanges(previous, current) {
			let changes = [];
			for (let [collectionID, currentRecord] of current) {
				let previousRecord = previous.get(collectionID);
				let oldPath = Array.isArray(previousRecord) ? previousRecord : previousRecord?.path;
				let newPath = Array.isArray(currentRecord) ? currentRecord : currentRecord?.path;
				if (!oldPath?.length || JSON.stringify(oldPath) === JSON.stringify(newPath)) {
					continue;
				}
				let oldParentID = Array.isArray(previousRecord) ? null : (previousRecord?.parentID ?? null);
				let newParentID = Array.isArray(currentRecord) ? null : (currentRecord?.parentID ?? null);
				let oldName = Array.isArray(previousRecord) ? oldPath[oldPath.length - 1] : (previousRecord?.name || oldPath[oldPath.length - 1] || "");
				let newName = Array.isArray(currentRecord) ? newPath[newPath.length - 1] : (currentRecord?.name || newPath[newPath.length - 1] || "");
				changes.push({
					collectionID,
					oldPath,
					newPath,
					oldParentID,
					newParentID,
					oldName,
					newName,
					parentChanged: oldParentID !== null && newParentID !== null && Number(oldParentID) !== Number(newParentID),
					nameChanged: oldName !== newName
				});
			}
			return changes;
		},

		async processCollectionPathChanges(changes, source = "", options = {}) {
			if (!Array.isArray(changes) || !changes.length) {
				return;
			}
			let pathSummary = String(options.pathSummary || "").trim();
			let signature = this.getCollectionPathChangeSignature(changes);
			let now = Date.now();
			if (signature && signature === this._lastCollectionPathChangeSignature && now - this._lastCollectionPathChangeAt < 3000) {
				Zotero.debug(`ZotLink: skipped duplicate collection path changes from ${source || "unknown"}`);
				return;
			}
			this._lastCollectionPathChangeSignature = signature;
			this._lastCollectionPathChangeAt = now;
			let root = this.getAttachmentMoveRoot();
			let folderStats = null;
			if (root) {
				folderStats = await this.moveCollectionFoldersForPathChanges(root, changes);
			}

			let itemIDs = await this.getItemIDsForCollectionIDs(changes.map(change => change.collectionID));
			await this.writeCollectionPathDiagnostic({
				source,
				previousSize: null,
				currentSize: null,
				changes,
				folderStats,
				itemIDs
			});
			let folderText = this.formatCollectionFolderResultForUser(folderStats);
			let pathText = pathSummary ? `；${pathSummary}` : "";
			if (!itemIDs.length) {
				this.showStatus(`分类文件夹同步完成${pathText}${folderText}；该分类下没有需要更新链接的 Zotero 条目。`, 10000);
				return;
			}
			this.showStatus(`分类文件夹同步完成${pathText}${folderText}；正在更新 ${itemIDs.length} 个条目的附件链接。`, 10000);
			this.scheduleAttachmentFileIDIndexing(itemIDs, {
				delay: 250,
				runAutomaticPDFOperations: false,
				collectionPathChanges: changes
			});
		},

		formatCollectionPathChangesForUser(changes) {
			let change = Array.isArray(changes) ? changes[0] : null;
			if (!change) {
				return "";
			}
			let root = this.getAttachmentMoveRoot();
			let oldFolder = root && change.oldPath?.length ? PathUtils.join(root, ...change.oldPath) : "";
			let newFolder = root && change.newPath?.length ? PathUtils.join(root, ...change.newPath) : "";
			let name = change.newName || change.oldName || "分类";
			let prefix = changes.length > 1 ? `“${name}”等 ${changes.length} 个分类` : `“${name}”`;
			if (oldFolder && newFolder) {
				return `${prefix}：${oldFolder} → ${newFolder}`;
			}
			return `${prefix}的位置已更新`;
		},

		formatCollectionFolderResultForUser(stats) {
			if (!stats) {
				return "";
			}
			let parts = [];
			if (stats.moved) {
				parts.push(stats.moved === 1 ? "文件夹已移动" : `已移动 ${stats.moved} 个文件夹`);
			}
			if (stats.merged) {
				parts.push(stats.merged === 1 ? "内容已合并到目标文件夹" : `已合并 ${stats.merged} 个文件夹`);
				if (stats.cleanupPending) {
					parts.push("源文件夹将在确认为空后后台清理");
				}
				else if (stats.removedSourceDirs) {
					parts.push("源空文件夹已删除");
				}
			}
			if (stats.skipped) {
				parts.push(`跳过 ${stats.skipped} 个无需处理的路径`);
			}
			return parts.length ? `；${parts.join("，")}` : "";
		},

		formatCollectionPathSnapshotSummary(previous, current, rootCollectionID, inferredCurrent = null, options = {}) {
			rootCollectionID = Number(rootCollectionID) || 0;
			let id = rootCollectionID || Number(previous?.keys?.().next?.().value) || 0;
			let before = id ? previous?.get?.(id) : null;
			let after = id ? current?.get?.(id) : null;
			let oldPath = (before?.path || []).join("/");
			let newPath = (after?.path || []).join("/");
			let root = this.getAttachmentMoveRoot();
			let oldFolder = root && before?.path?.length ? PathUtils.join(root, ...before.path) : "";
			let newFolder = root && after?.path?.length ? PathUtils.join(root, ...after.path) : "";
			let parts = options.includeRoot === false
				? []
				: [`rootCollectionID=${id || rootCollectionID || "unknown"}`];
			if (before && after) {
				parts.push(
					oldPath ? `旧路径=${oldPath}` : "",
					newPath ? `新路径=${newPath}` : "",
					oldFolder ? `旧文件夹=${oldFolder}` : "",
					newFolder ? `新文件夹=${newFolder}` : ""
				);
				return parts.filter(Boolean).join("；");
			}

			if (before) {
				parts.push(oldPath ? `拖拽前路径=${oldPath}` : "", oldFolder ? `拖拽前文件夹=${oldFolder}` : "");
			}
			let currentRecord = after || inferredCurrent;
			let currentPath = (currentRecord?.path || []).join("/");
			let currentFolder = root && currentRecord?.path?.length ? PathUtils.join(root, ...currentRecord.path) : "";
			let label = after ? "当前路径" : "当前推测路径";
			parts.push(
				currentPath ? `${label}=${currentPath}` : "当前推测路径=无法解析",
				currentFolder ? `${label.replace("路径", "文件夹")}=${currentFolder}` : ""
			);
			return parts.filter(Boolean).join("；");
		},

		async writeCollectionPathDiagnostic({ source, previousSize, currentSize, changes, folderStats, itemIDs, previousSnapshot = null, currentSnapshot = null, rootCollectionID = null, inferredCurrent = null }) {
			let lines = [
				"ZotLink 分类路径变化诊断",
				`时间：${new Date().toISOString()}`,
				`来源：${source || "(unknown)"}`,
				rootCollectionID ? `rootCollectionID：${rootCollectionID}` : "",
				previousSize === null || previousSize === undefined ? "" : `拖拽前快照 collection 数：${previousSize}`,
				currentSize === null || currentSize === undefined ? "" : `拖拽后快照 collection 数：${currentSize}`,
				previousSnapshot && currentSnapshot ? `拖拽根路径：${this.formatCollectionPathSnapshotSummary(previousSnapshot, currentSnapshot, rootCollectionID, inferredCurrent, { includeRoot: false })}` : "",
				`路径变化数：${changes?.length || 0}`,
				folderStats ? `文件夹移动统计：移动 ${folderStats.moved || 0}；合并 ${folderStats.merged || 0}；跳过 ${folderStats.skipped || 0}；源目录已删除 ${folderStats.removedSourceDirs || 0}；后台清理 ${folderStats.cleanupPending || 0}` : "文件夹移动统计：未执行",
				`下属 Zotero 条目数：${itemIDs?.length || 0}`,
				""
			].filter(Boolean);
			for (let change of changes || []) {
				lines.push([
					`collectionID=${change.collectionID}`,
					`name=${change.oldName || change.newName || ""}`,
					`parent=${change.oldParentID ?? "(none)"} -> ${change.newParentID ?? "(none)"}`,
					`parentChanged=${change.parentChanged ? "yes" : "no"}`,
					`nameChanged=${change.nameChanged ? "yes" : "no"}`,
					`old=${(change.oldPath || []).join("/")}`,
					`new=${(change.newPath || []).join("/")}`,
					`oldFolder=${this.getAttachmentMoveRoot() && change.oldPath?.length ? PathUtils.join(this.getAttachmentMoveRoot(), ...change.oldPath) : ""}`,
					`newFolder=${this.getAttachmentMoveRoot() && change.newPath?.length ? PathUtils.join(this.getAttachmentMoveRoot(), ...change.newPath) : ""}`
				].join("；"));
			}
			try {
				return await this.writeTextReport("zotlink-collection-path-diagnostic", lines.join("\n"));
			}
			catch (e) {
				Zotero.logError(e);
				return "(诊断写入失败)";
			}
		},

		getCollectionPathChangeSignature(changes) {
			return (changes || [])
				.map(change => `${Number(change.collectionID) || 0}:${change.oldParentID ?? ""}>${change.newParentID ?? ""}:${(change.oldPath || []).join("/")}>${(change.newPath || []).join("/")}`)
				.sort()
				.join("|");
		},

		async getItemIDsForCollectionIDs(collectionIDs) {
			let ids = Array.from(new Set((collectionIDs || [])
				.map(id => Number(id))
				.filter(id => Number.isInteger(id) && id > 0)));
			let itemIDs = new Set();
			for (let offset = 0; offset < ids.length; offset += 400) {
				let batch = ids.slice(offset, offset + 400);
				let placeholders = batch.map(() => "?").join(",");
				let rows = await Zotero.DB.queryAsync(
					`SELECT DISTINCT itemID FROM collectionItems WHERE collectionID IN (${placeholders})`,
					batch
				);
				for (let row of rows || []) {
					let itemID = Number(row?.itemID ?? row);
					if (Number.isInteger(itemID) && itemID > 0) {
						itemIDs.add(itemID);
					}
				}
			}
			return Array.from(itemIDs);
		},

		async moveCollectionFoldersForPathChanges(root, changes) {
			if (!root || !Array.isArray(changes) || !changes.length) {
				return { moved: 0, merged: 0, skipped: 0, removedSourceDirs: 0, cleanupPending: 0 };
			}
			let movedOldRoots = [];
			let stats = { moved: 0, merged: 0, skipped: 0, removedSourceDirs: 0, cleanupPending: 0 };
			let candidates = changes
				.map(change => ({
					...change,
					oldPath: Array.isArray(change.oldPath) ? change.oldPath.filter(Boolean) : [],
					newPath: Array.isArray(change.newPath) ? change.newPath.filter(Boolean) : []
				}))
				.filter(change => change.oldPath.length && change.newPath.length)
				.sort((a, b) => a.oldPath.length - b.oldPath.length);

			for (let change of candidates) {
				if (movedOldRoots.some(oldRoot => this.pathSegmentsStartWith(change.oldPath, oldRoot))) {
					stats.skipped++;
					continue;
				}
				let oldDir = PathUtils.join(root, ...change.oldPath);
				let newDir = PathUtils.join(root, ...change.newPath);
				if (this.pathsEqual(oldDir, newDir)) {
					stats.skipped++;
					continue;
				}
				try {
					if (!(await IOUtils.exists(oldDir))) {
						await IOUtils.makeDirectory(newDir, { createAncestors: true });
						stats.skipped++;
						continue;
					}
					await IOUtils.makeDirectory(this.getParentPath(newDir), { createAncestors: true });
					if (await IOUtils.exists(newDir)) {
						let mergeResult = await this.mergeDirectoryContents(oldDir, newDir);
						stats.merged++;
						if (mergeResult.removed) {
							stats.removedSourceDirs++;
						}
						else {
							stats.cleanupPending++;
						}
					}
					else {
						await IOUtils.move(oldDir, newDir);
						stats.moved++;
					}
					movedOldRoots.push(change.oldPath);
				}
				catch (e) {
					Zotero.logError(e);
					try {
						await IOUtils.makeDirectory(newDir, { createAncestors: true });
					}
					catch (inner) {
						Zotero.logError(inner);
					}
					stats.skipped++;
				}
			}
			return stats;
		},

		pathSegmentsStartWith(pathSegments, prefixSegments) {
			if (!Array.isArray(pathSegments) || !Array.isArray(prefixSegments) || prefixSegments.length > pathSegments.length) {
				return false;
			}
			return prefixSegments.every((segment, index) => String(pathSegments[index] || "").toLowerCase() === String(segment || "").toLowerCase());
		},

		async mergeDirectoryContents(sourceDir, targetDir) {
			let sourceLocator = await this.getWindowsFileIDQuiet(sourceDir);
			await IOUtils.makeDirectory(targetDir, { createAncestors: true });
			let children = await IOUtils.getChildren(sourceDir);
			for (let child of children || []) {
				let name = PathUtils.filename(child);
				let destination = PathUtils.join(targetDir, name);
				if (await IOUtils.exists(destination)) {
					let isSourceDir = await this.isDirectoryPath(child);
					let isDestinationDir = await this.isDirectoryPath(destination);
					if (isSourceDir && isDestinationDir) {
						await this.mergeDirectoryContents(child, destination);
					}
					else {
						let uniqueDestination = await this.getUniqueDestinationPath(destination);
						if (uniqueDestination) {
							await IOUtils.move(child, uniqueDestination);
						}
					}
				}
				else {
					await IOUtils.move(child, destination);
				}
			}
			if (sourceLocator.fileID) {
				this.scheduleEmptyDirectoryCleanup(sourceDir, sourceLocator.fileID);
				return {
					empty: false,
					removed: false,
					childCount: null,
					reason: "等待后台按文件夹机内码安全清理"
				};
			}
			return {
				empty: false,
				removed: false,
				childCount: null,
				reason: "无法读取源文件夹机内码，已放弃延迟删除"
			};
		},

		async removeDirectoryIfEmpty(directoryPath, expectedFileID = "") {
			try {
				if (!(await IOUtils.exists(directoryPath))) {
					return { empty: true, removed: true, childCount: 0, reason: "目录已不存在" };
				}
				if (expectedFileID) {
					let currentLocator = await this.getWindowsFileIDQuiet(directoryPath);
					if (!currentLocator.fileID) {
						return { empty: false, removed: false, childCount: null, identityUnverified: true, reason: "无法验证当前文件夹机内码" };
					}
					if (!this.fileIDsEqual(currentLocator.fileID, expectedFileID)) {
						return { empty: false, removed: false, childCount: null, identityChanged: true, currentFileID: currentLocator.fileID, reason: "路径已指向后来创建的其他文件夹" };
					}
				}
				let children = await IOUtils.getChildren(directoryPath);
				if (children.length) {
					return { empty: false, removed: false, childCount: children.length, reason: "目录非空" };
				}
				try {
					await IOUtils.remove(directoryPath);
					let removed = !(await IOUtils.exists(directoryPath));
					if (removed) {
						return { empty: true, removed: true, childCount: 0, reason: "空目录已删除" };
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
				if (expectedFileID) {
					return await this.removeEmptyDirectoryWithPython(directoryPath, expectedFileID);
				}
				return { empty: true, removed: false, childCount: 0, reason: "IOUtils 删除失败且没有可验证的文件夹机内码" };
			}
			catch (e) {
				Zotero.logError(e);
				return { empty: false, removed: false, childCount: null, reason: this.errorToText(e) || "检查或删除失败" };
			}
		},

		async removeEmptyDirectoryWithPython(directoryPath, expectedFileID) {
			let scriptPath = this.getTempTextPath("zotlink-empty-directory-remove").replace(/\.txt$/i, ".py");
			let outputPath = this.getTempTextPath("zotlink-empty-directory-remove");
			let script = [
				"import ctypes, os, sys, traceback",
				"path, expected, output_path = sys.argv[1], sys.argv[2].lower(), sys.argv[3]",
				"kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)",
				"FILE_SHARE_READ = 0x00000001",
				"FILE_SHARE_WRITE = 0x00000002",
				"FILE_SHARE_DELETE = 0x00000004",
				"OPEN_EXISTING = 3",
				"FILE_FLAG_BACKUP_SEMANTICS = 0x02000000",
				"FILE_ATTRIBUTE_READONLY = 0x00000001",
				"INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF",
				"INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value",
				"class FILETIME(ctypes.Structure):",
				"    _fields_ = [('dwLowDateTime', ctypes.c_uint32), ('dwHighDateTime', ctypes.c_uint32)]",
				"class INFO(ctypes.Structure):",
				"    _fields_ = [('attrs', ctypes.c_uint32), ('ctime', FILETIME), ('atime', FILETIME), ('mtime', FILETIME), ('volume', ctypes.c_uint32), ('sizeHigh', ctypes.c_uint32), ('sizeLow', ctypes.c_uint32), ('links', ctypes.c_uint32), ('indexHigh', ctypes.c_uint32), ('indexLow', ctypes.c_uint32)]",
				"kernel32.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]",
				"kernel32.CreateFileW.restype = ctypes.c_void_p",
				"kernel32.GetFileInformationByHandle.argtypes = [ctypes.c_void_p, ctypes.POINTER(INFO)]",
				"kernel32.GetFileInformationByHandle.restype = ctypes.c_int",
				"kernel32.CloseHandle.argtypes = [ctypes.c_void_p]",
				"kernel32.CloseHandle.restype = ctypes.c_int",
				"kernel32.GetFileAttributesW.argtypes = [ctypes.c_wchar_p]",
				"kernel32.GetFileAttributesW.restype = ctypes.c_uint32",
				"kernel32.SetFileAttributesW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32]",
				"kernel32.SetFileAttributesW.restype = ctypes.c_int",
				"def file_id(p):",
				"    handle = kernel32.CreateFileW(p, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, None, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None)",
				"    if handle == INVALID_HANDLE_VALUE: raise ctypes.WinError(ctypes.get_last_error())",
				"    try:",
				"        info = INFO()",
				"        if not kernel32.GetFileInformationByHandle(handle, ctypes.byref(info)): raise ctypes.WinError(ctypes.get_last_error())",
				"        return ('0x%08x:0x%016x' % (info.volume, (info.indexHigh << 32) | info.indexLow)).lower()",
				"    finally: kernel32.CloseHandle(handle)",
				"status = ''",
				"try:",
				"    if not os.path.isdir(path): status = 'ABSENT'",
				"    else:",
				"        current = file_id(path)",
				"        if current != expected: status = 'IDENTITY_CHANGED\\t' + current",
				"        else:",
				"            with os.scandir(path) as entries: nonempty = next(entries, None) is not None",
				"            if nonempty: status = 'NONEMPTY'",
				"            else:",
				"                current = file_id(path)",
				"                if current != expected: status = 'IDENTITY_CHANGED\t' + current",
				"                else:",
				"                    attrs = kernel32.GetFileAttributesW(path)",
				"                    if attrs == INVALID_FILE_ATTRIBUTES: raise ctypes.WinError(ctypes.get_last_error())",
				"                    if attrs & FILE_ATTRIBUTE_READONLY:",
				"                        if not kernel32.SetFileAttributesW(path, attrs & ~FILE_ATTRIBUTE_READONLY): raise ctypes.WinError(ctypes.get_last_error())",
				"                    os.rmdir(path)",
				"                    status = 'REMOVED' if not os.path.exists(path) else 'STILL_EXISTS'",
				"except Exception as e: status = 'ERROR\\t' + ''.join(traceback.format_exception_only(type(e), e)).strip()",
				"with open(output_path, 'w', encoding='utf-8') as f: f.write(status)"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(script));
				let result = await this.execDiagnosticCommand("C:\\Windows\\pyw.exe", ["-3", scriptPath, directoryPath, expectedFileID, outputPath], outputPath);
				let text = String(result.text || "").trim();
				if (/^(REMOVED|ABSENT)$/i.test(text)) {
					return { empty: true, removed: true, childCount: 0, reason: `Python：${text}` };
				}
				if (/^IDENTITY_CHANGED/i.test(text)) {
					return { empty: false, removed: false, childCount: null, identityChanged: true, reason: `Python：${text}` };
				}
				if (/^NONEMPTY/i.test(text)) {
					return { empty: false, removed: false, childCount: null, reason: "Python：目录非空" };
				}
				return { empty: true, removed: false, childCount: 0, reason: `Python 删除失败：${text || result.diagnostic}` };
			}
			catch (e) {
				Zotero.logError(e);
				return { empty: true, removed: false, childCount: 0, reason: this.errorToText(e) || "Python 删除失败" };
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

		async isActiveCollectionFolder(directoryPath) {
			let root = this.getAttachmentMoveRoot();
			if (!root || !directoryPath) {
				return false;
			}
			let target = this.normalizePathForCompare(directoryPath);
			let snapshot = await this.buildCollectionPathSnapshotAsync();
			for (let record of snapshot.values()) {
				if (record?.path?.length
					&& this.normalizePathForCompare(PathUtils.join(root, ...record.path)) === target) {
					return true;
				}
			}
			return false;
		},

		scheduleEmptyDirectoryCleanup(directoryPath, expectedFileID) {
			expectedFileID = this.normalizeFileIDForCompare(expectedFileID);
			let key = `${this.normalizePathForCompare(directoryPath)}|${expectedFileID}`;
			if (!directoryPath || !expectedFileID || this._pendingEmptyDirectoryCleanupPaths.has(key)) {
				return;
			}
			this._pendingEmptyDirectoryCleanupPaths.add(key);
			let delays = [500, 1000, 2000, 4000, 8000, 15000, 30000];
			let attemptIndex = 0;
			let diagnosticPath = this.getTempTextPath("zotlink-empty-directory-cleanup");
			let diagnosticLines = [
				"ZotLink 空目录后台清理诊断",
				`开始时间：${new Date().toISOString()}`,
				`目录：${directoryPath}`,
				`源文件夹机内码：${expectedFileID}`
			];
			let writeDiagnostic = async () => {
				try {
					await IOUtils.write(diagnosticPath, new TextEncoder().encode(diagnosticLines.join("\n")));
				}
				catch (e) {
					Zotero.logError(e);
				}
			};
			let finish = async reason => {
				this._pendingEmptyDirectoryCleanupPaths.delete(key);
				diagnosticLines.push(`结束时间：${new Date().toISOString()}`, `结果：${reason}`);
				await writeDiagnostic();
			};
			writeDiagnostic().catch(e => Zotero.logError(e));
			let scheduleNext = () => {
				if (attemptIndex >= delays.length) {
					finish("达到有限重试上限，保留目录").catch(e => Zotero.logError(e));
					return;
				}
				let delay = delays[attemptIndex++];
				let timer = setTimeout(async () => {
					this._emptyDirectoryCleanupTimers.delete(timer);
					let attemptNumber = attemptIndex;
					if (!(await IOUtils.exists(directoryPath))) {
						diagnosticLines.push(`尝试 ${attemptNumber}：原目录已不存在`);
						await finish("原目录已不存在");
						return;
					}
					let currentLocator = await this.getWindowsFileIDQuiet(directoryPath);
					if (!currentLocator.fileID) {
						diagnosticLines.push(`尝试 ${attemptNumber}：无法验证当前文件夹机内码，暂不删除`);
						await writeDiagnostic();
						scheduleNext();
						return;
					}
					if (!this.fileIDsEqual(currentLocator.fileID, expectedFileID)) {
						diagnosticLines.push(`尝试 ${attemptNumber}：文件夹机内码已变化；当前=${currentLocator.fileID}；旧任务作废`);
						await finish("路径已被后来创建的其他文件夹复用，未删除");
						return;
					}
					if (await this.isActiveCollectionFolder(directoryPath)) {
						diagnosticLines.push(`尝试 ${attemptNumber}：当前仍对应有效分类路径，暂不删除并继续等待`);
						await writeDiagnostic();
						scheduleNext();
						return;
					}
					let result = await this.removeDirectoryIfEmpty(directoryPath, expectedFileID);
					diagnosticLines.push(`尝试 ${attemptNumber}：empty=${result.empty ? "yes" : "no"}；removed=${result.removed ? "yes" : "no"}；children=${result.childCount ?? "unknown"}；${result.reason || ""}`);
					await writeDiagnostic();
					if (result.identityChanged) {
						await finish("文件夹身份已变化，未删除");
						return;
					}
					if (result.removed) {
						await finish("目录已安全删除");
						return;
					}
					scheduleNext();
				}, delay);
				this._emptyDirectoryCleanupTimers.add(timer);
			};
			scheduleNext();
		},

		clearEmptyDirectoryCleanupTimers() {
			for (let timer of this._emptyDirectoryCleanupTimers) {
				clearTimeout(timer);
			}
			this._emptyDirectoryCleanupTimers.clear();
			this._pendingEmptyDirectoryCleanupPaths.clear();
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
			this._pendingCollectionPathChanges.clear();
			this._pendingAutomaticPDFOperationItemIDs.clear();
			this._attachmentFileIDRetryCounts.clear();
			this._collectionPathSnapshot.clear();
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
			for (let change of options.collectionPathChanges || []) {
				let collectionID = Number(change?.collectionID);
				let oldPath = Array.isArray(change?.oldPath) ? change.oldPath.filter(Boolean) : [];
				let newPath = Array.isArray(change?.newPath) ? change.newPath.filter(Boolean) : [];
				if (!Number.isInteger(collectionID) || collectionID <= 0 || !oldPath.length) {
					continue;
				}
				let pending = this._pendingCollectionPathChanges.get(collectionID);
				let firstOldPath = pending?.oldPath?.length ? pending.oldPath : oldPath;
				if (JSON.stringify(firstOldPath) === JSON.stringify(newPath)) {
					this._pendingCollectionPathChanges.delete(collectionID);
				}
				else {
					this._pendingCollectionPathChanges.set(collectionID, {
						collectionID,
						oldPath: firstOldPath,
						newPath
					});
				}
			}
			let ids = Array.isArray(itemIDs) ? itemIDs : [itemIDs];
			for (let id of ids) {
				if (id) {
					this._pendingAttachmentFileIDItemIDs.add(id);
					if (options.runAutomaticPDFOperations) {
						this._pendingAutomaticPDFOperationItemIDs.add(Number(id));
					}
				}
			}
			for (let id of options.automaticOperationItemIDs || []) {
				id = Number(id);
				if (Number.isInteger(id) && id > 0) {
					this._pendingAutomaticPDFOperationItemIDs.add(id);
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
			let collectionPathChanges = Array.from(this._pendingCollectionPathChanges.values());
			let automaticPDFOperationItemIDs = new Set(this._pendingAutomaticPDFOperationItemIDs);
			let diagnosticLines = [];
			this._pendingAttachmentFileIDItemIDs.clear();
			this._pendingAttachmentFileIDDiagnostics = false;
			this._pendingPreferredPrimaryCollectionIDs.clear();
			this._pendingRemovedCollectionIDs.clear();
			this._pendingCollectionPathChanges.clear();
			this._pendingAutomaticPDFOperationItemIDs.clear();
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
			let retryItemIDs = [];
			let retryAutomaticOperationItemIDs = [];
			for (let attachment of attachments) {
				try {
					let moveResult = await this.autoMoveStoredAttachmentToCollectionPath(attachment);
					if (moveResult.ok) {
						changed = true;
					}
					if (this.shouldRunAutomaticPDFOperationsForAttachment(attachment, automaticPDFOperationItemIDs)) {
						await this.runAutomaticPDFOperations(attachment, { firstImport: true });
					}
					if (!(await this.isAttachmentFileIDIndexCurrent(attachment, index))) {
						let result = await this.indexAttachmentFileID(attachment, {
							quiet: true,
							index,
							save: false
						});
						changed = changed || Boolean(result.ok);
						if (!result.ok && this.shouldRetryAttachmentFileIDIndexing(result.reason)) {
							retryItemIDs.push(attachment.id);
							if (this.shouldRunAutomaticPDFOperationsForAttachment(attachment, automaticPDFOperationItemIDs)) {
								retryAutomaticOperationItemIDs.push(attachment.id);
							}
						}
					}
					let syncResult = await this.syncAttachmentMirrors(attachment, {
						index,
						save: false,
						diagnostics: diagnosticsEnabled ? [] : null,
						preferredCollectionID: preferredPrimaryCollectionIDs.get(attachment.parentItem?.id),
						removedCollectionIDs: removedCollectionIDs.get(attachment.parentItem?.id) || [],
						collectionPathChanges
					});
					changed = changed || Boolean(syncResult.changed);
					this._attachmentFileIDRetryCounts.delete(attachment.id);
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
			this.scheduleAttachmentFileIDRetries(retryItemIDs, retryAutomaticOperationItemIDs);
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

		shouldRetryAttachmentFileIDIndexing(reason) {
			return /源文件不存在|无法读取机内码/.test(String(reason || ""));
		},

		shouldRunAutomaticPDFOperationsForAttachment(attachment, itemIDs) {
			return itemIDs?.has?.(Number(attachment?.id))
				|| itemIDs?.has?.(Number(attachment?.parentItem?.id));
		},

		scheduleAttachmentFileIDRetries(itemIDs, automaticOperationItemIDs = []) {
			let retryIDs = [];
			for (let itemID of itemIDs || []) {
				itemID = Number(itemID);
				if (!Number.isInteger(itemID) || itemID <= 0) {
					continue;
				}
				let count = this._attachmentFileIDRetryCounts.get(itemID) || 0;
				if (count >= 3) {
					continue;
				}
				this._attachmentFileIDRetryCounts.set(itemID, count + 1);
				retryIDs.push(itemID);
			}
			if (retryIDs.length) {
				this.scheduleAttachmentFileIDIndexing(retryIDs, {
					delay: 15000,
					automaticOperationItemIDs
				});
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
					this.saveAttachmentPreferenceInputs(doc);
					return;
				}

				if (action === "repairAllLibraryLinks") {
					let originalLabel = button?.getAttribute?.("label") || "检查并修复全库附件链接";
					if (button) {
						button.disabled = true;
						button.setAttribute("label", "准备检查...");
					}
					this.runPreferenceBackgroundAction(button, originalLabel, async () => {
						await this.repairAllLibraryAttachmentLinksByFileID({
							onProgress: ({ processed, total }) => {
								button?.setAttribute?.("label", `链接 ${processed}/${total}`);
							}
						});
					}, "ZotLink 全库附件链接检查失败");
					return;
				}

				if (action === "updateAllLibrary") {
					let originalLabel = button?.getAttribute?.("label") || "按勾选项目更新全库";
					if (button) {
						button.disabled = true;
						button.setAttribute("label", "准备更新...");
					}
					this.runPreferenceBackgroundAction(button, originalLabel, async () => {
						await this.updateAllLibraryBySelectedOptions({ button });
					}, "ZotLink 全库更新失败");
					return;
				}

				if (action === "importRootPDFLibrary") {
					let originalLabel = button?.getAttribute?.("label") || "从顶层文件夹重建链接库";
					if (button) {
						button.disabled = true;
						button.setAttribute("label", "准备重建...");
					}
					this.runPreferenceBackgroundAction(button, originalLabel, async () => {
						await this.importPDFsFromAttachmentRootFolder({
							useProgressWindow: false,
							softProgress: false,
							onStage: ({ buttonLabel }) => {
								if (buttonLabel) {
									button?.setAttribute?.("label", buttonLabel);
								}
							},
							onScanProgress: ({ directories, pdfs }) => {
								button?.setAttribute?.("label", `扫描 ${directories} 夹 / ${pdfs} PDF`);
							},
							onProgress: ({ processed, total }) => {
								button?.setAttribute?.("label", `正在导入 ${processed}/${total}`);
							}
						});
					}, "顶层文件夹链接库重建失败");
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

		async updateAllLibraryBySelectedOptions(options = {}) {
			let button = options.button;
			let selected = {
				doi: this.getBoolPref("autoWritePDFDOIMetadata", true),
				pageLabels: this.getBoolPref("autoAlignPDFPageLabels", true),
				openFirstPage: this.getBoolPref("autoSetPDFOpenToFirstPage", true),
				displayFileName: this.getBoolPref("autoSetPDFDisplayTitleFileName", true),
				articleHistory: this.getBoolPref("autoExtractArticleHistory", false)
			};
			if (!Object.values(selected).some(Boolean)) {
				this.showSoftReport("未勾选任何可用于全库更新的项目。", 5000);
				return;
			}

			let summaries = [];
			let startedAt = Date.now();
			button?.setAttribute?.("label", "正在检查附件链接...");
			let linkResult = await this.repairAllLibraryAttachmentLinksByFileID({
				silent: true,
				onProgress: ({ processed, total }) => {
					button?.setAttribute?.("label", `链接 ${processed}/${total}`);
				}
			});
			if (linkResult?.repaired) {
				summaries.push(`链接修复 ${linkResult.repaired}`);
			}
			if (selected.doi || selected.pageLabels || selected.openFirstPage || selected.displayFileName) {
				button?.setAttribute?.("label", "正在处理 PDF...");
				let result = await this.writeAllLibraryPDFDOIMetadata({
					useProgressWindow: false,
					silent: true,
					requireManagedPath: true,
					writeDOIMetadata: selected.doi,
					alignPageLabels: selected.pageLabels,
					openToFirstPage: selected.openFirstPage,
					displayTitleFileName: selected.displayFileName,
					onProgress: ({ processed, total }) => {
						button?.setAttribute?.("label", `PDF ${processed}/${total}`);
					}
				});
				if (selected.doi) {
					summaries.push(`DOI 元数据更新 ${result?.written || 0}`);
				}
				if (selected.pageLabels) {
					summaries.push(`页码对齐 ${result?.pageLabelsAligned || 0}`);
				}
				if (selected.openFirstPage || selected.displayFileName) {
					summaries.push(`查看设置更新 ${result?.viewerPreferencesUpdated || 0}`);
				}
			}

			if (selected.articleHistory) {
				button?.setAttribute?.("label", "正在提取文章历史...");
				let result = await this.writeAllLibraryArticleHistory({
					useProgressWindow: false,
					silent: true,
					requireManagedPath: true,
					onProgress: ({ processed, total }) => {
						button?.setAttribute?.("label", `文章历史 ${processed}/${total}`);
					}
				});
				summaries.push(`文章历史写入 ${result?.written || 0}`);
			}

			let seconds = Math.round((Date.now() - startedAt) / 1000);
			this.showSoftReport(`全库更新完成：${summaries.join("；")}。耗时约 ${seconds} 秒。`, 9000);
		},

		runPreferenceBackgroundAction(button, originalLabel, task, failureTitle) {
			let run = async () => {
				try {
					await task();
				}
				catch (e) {
					Zotero.logError(e);
					this.showSoftReport(`${failureTitle}：${this.errorToText(e) || String(e)}`, 8000);
				}
				finally {
					if (button) {
						button.disabled = false;
						button.setAttribute("label", originalLabel);
					}
				}
			};
			if (button?.ownerGlobal?.setTimeout) {
				button.ownerGlobal.setTimeout(() => run(), 100);
			}
			else {
				setTimeout(() => run(), 100);
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

		updateCurrentShortcutLabel(doc, shortcut, labelID = "zotlink-current-shortcut") {
			let label = doc.getElementById(labelID);
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
			let labelID = this.getShortcutLabelIDForInput(input);
			let shortcut = this.shortcutFromKeyboardEvent(event);
			if (!shortcut) {
				if (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape") {
					this.setInputValue(input, "");
					this.updateCurrentShortcutLabel(input.ownerDocument, "", labelID);
					this.saveAttachmentPreferenceInputs(input.ownerDocument);
					event.preventDefault();
				}
				return;
			}
			this.setInputValue(input, shortcut);
			this.updateCurrentShortcutLabel(input.ownerDocument, shortcut, labelID);
			this.saveAttachmentPreferenceInputs(input.ownerDocument);
			event.preventDefault();
			event.stopPropagation();
		},

		getShortcutLabelIDForInput(input) {
			if (input?.id === "zotlink-copy-link-shortcut") {
				return "zotlink-current-copy-link-shortcut";
			}
			if (input?.id === "zotlink-copy-obsidian-link-shortcut") {
				return "zotlink-current-copy-obsidian-link-shortcut";
			}
			return "zotlink-current-shortcut";
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

		insertLocalization(win) {
			try {
				win.MozXULElement?.insertFTLIfNeeded(FTL_FILE);
			}
			catch (e) {
				Zotero.debug("ZotLink: failed to insert Fluent localization", 1);
			}
		},

		registerArticleHistoryInfoRows() {
			if (!Zotero.ItemPaneManager?.registerInfoRow) {
				return;
			}
			for (let definition of ARTICLE_HISTORY_INFO_ROWS) {
				this.registerArticleHistoryInfoRow(definition);
			}
			this.refreshArticleHistoryInfoRows();
		},

		registerArticleHistoryInfoRow(definition) {
			for (let position of ["afterDate", "afterCreators", "end"]) {
				try {
					let registeredID = Zotero.ItemPaneManager.registerInfoRow({
						rowID: definition.rowID,
						pluginID: this._pluginID,
						label: {
							l10nID: definition.l10nID
						},
						position,
						multiline: false,
						nowrap: false,
						editable: true,
						onGetData: ({ item }) => this.getArticleHistoryDateValue(item, definition.key),
						onSetData: async ({ item, value }) => {
							if (!this.isJournalArticleItem(item)) {
								return;
							}
							if (!this.isISODateValue(value)) {
								throw new Error(`${definition.key} 必须使用 YYYY-MM-DD 格式`);
							}
							await this.setArticleHistoryDateValue(item, definition.key, value);
						},
						onItemChange: ({ item, setEnabled, setEditable }) => {
							let enabled = this.isJournalArticleItem(item);
							setEnabled(enabled);
							setEditable(enabled);
						}
					});
					this._registeredInfoRows.add(registeredID || definition.rowID);
					return;
				}
				catch (e) {
					if (position === "end") {
						Zotero.logError(e);
						Zotero.debug(`ZotLink: failed to register article history info row ${definition.key}`, 1);
					}
				}
			}
		},

		unregisterArticleHistoryInfoRows() {
			for (let rowID of this._registeredInfoRows) {
				try {
					Zotero.ItemPaneManager?.unregisterInfoRow?.(rowID);
				}
				catch (e) {
					Zotero.debug(`ZotLink: failed to unregister info row ${rowID}`, 1);
				}
			}
			this._registeredInfoRows.clear();
		},

		refreshArticleHistoryInfoRows() {
			for (let rowID of this._registeredInfoRows) {
				try {
					Zotero.ItemPaneManager?.refreshInfoRow?.(rowID);
				}
				catch (e) {
					Zotero.debug(`ZotLink: failed to refresh info row ${rowID}`, 1);
				}
			}
		},

		initializePreferencePane(doc) {
			try {
				let rootInput = doc.getElementById("zotlink-move-root");
				this.setInputValue(rootInput, this.getPref("attachmentMoveRoot", DEFAULT_ATTACHMENT_MOVE_ROOT));
				let shortcutInput = doc.getElementById("zotlink-move-shortcut");
				let shortcut = this.getPref("attachmentMoveShortcut", "");
				this.setInputValue(shortcutInput, shortcut);
				this.updateCurrentShortcutLabel(doc, shortcut);
				let copyLinkShortcutInput = doc.getElementById("zotlink-copy-link-shortcut");
				let copyLinkShortcut = this.getPref("copyLinkShortcut", "");
				this.setInputValue(copyLinkShortcutInput, copyLinkShortcut);
				this.updateCurrentShortcutLabel(doc, copyLinkShortcut, "zotlink-current-copy-link-shortcut");
				let copyObsidianLinkShortcutInput = doc.getElementById("zotlink-copy-obsidian-link-shortcut");
				let copyObsidianLinkShortcut = this.getPref("copyObsidianLinkShortcut", "");
				this.setInputValue(copyObsidianLinkShortcutInput, copyObsidianLinkShortcut);
				this.updateCurrentShortcutLabel(doc, copyObsidianLinkShortcut, "zotlink-current-copy-obsidian-link-shortcut");
				this.initializePreferenceCheckboxes(doc);
				this.attachPreferenceAutoSaveHandlers(doc);
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		getPDFOperationPreferenceDefinitions() {
			return [
				["zotlink-auto-write-doi-metadata", "autoWritePDFDOIMetadata", true],
				["zotlink-auto-rename-new-attachments", "autoRenameNewAttachments", false],
				["zotlink-auto-align-page-labels", "autoAlignPDFPageLabels", true],
				["zotlink-auto-set-open-first-page", "autoSetPDFOpenToFirstPage", true],
				["zotlink-auto-display-title-filename", "autoSetPDFDisplayTitleFileName", true],
				["zotlink-auto-extract-article-history", "autoExtractArticleHistory", false],
				["zotlink-use-alert-for-collection-import-completion", "useAlertForCollectionImportCompletion", false]
			];
		},

		initializePreferenceCheckboxes(doc) {
			for (let [elementID, prefKey, fallback] of this.getPDFOperationPreferenceDefinitions()) {
				let checkbox = doc.getElementById(elementID);
				if (checkbox) {
					checkbox.checked = this.getBoolPref(prefKey, fallback);
				}
			}
		},

		attachPreferenceAutoSaveHandlers(doc) {
			let rootInput = doc.getElementById("zotlink-move-root");
			let shortcutInput = doc.getElementById("zotlink-move-shortcut");
			let copyLinkShortcutInput = doc.getElementById("zotlink-copy-link-shortcut");
			let copyObsidianLinkShortcutInput = doc.getElementById("zotlink-copy-obsidian-link-shortcut");
			if (rootInput && !rootInput.dataset.zotlinkAutoSaveAttached) {
				rootInput.dataset.zotlinkAutoSaveAttached = "true";
				rootInput.addEventListener("input", () => this.schedulePreferenceAutoSave(doc));
				rootInput.addEventListener("change", () => this.saveAttachmentPreferenceInputs(doc));
				rootInput.addEventListener("blur", () => this.saveAttachmentPreferenceInputs(doc));
			}
			if (shortcutInput && !shortcutInput.dataset.zotlinkAutoSaveAttached) {
				shortcutInput.dataset.zotlinkAutoSaveAttached = "true";
				shortcutInput.addEventListener("change", () => this.saveAttachmentPreferenceInputs(doc));
				shortcutInput.addEventListener("blur", () => this.saveAttachmentPreferenceInputs(doc));
			}
			if (copyLinkShortcutInput && !copyLinkShortcutInput.dataset.zotlinkAutoSaveAttached) {
				copyLinkShortcutInput.dataset.zotlinkAutoSaveAttached = "true";
				copyLinkShortcutInput.addEventListener("change", () => this.saveAttachmentPreferenceInputs(doc));
				copyLinkShortcutInput.addEventListener("blur", () => this.saveAttachmentPreferenceInputs(doc));
			}
			if (copyObsidianLinkShortcutInput && !copyObsidianLinkShortcutInput.dataset.zotlinkAutoSaveAttached) {
				copyObsidianLinkShortcutInput.dataset.zotlinkAutoSaveAttached = "true";
				copyObsidianLinkShortcutInput.addEventListener("change", () => this.saveAttachmentPreferenceInputs(doc));
				copyObsidianLinkShortcutInput.addEventListener("blur", () => this.saveAttachmentPreferenceInputs(doc));
			}
			for (let [elementID] of this.getPDFOperationPreferenceDefinitions()) {
				let checkbox = doc.getElementById(elementID);
				if (checkbox && !checkbox.dataset.zotlinkAutoSaveAttached) {
					checkbox.dataset.zotlinkAutoSaveAttached = "true";
					checkbox.addEventListener("command", () => this.saveAttachmentPreferenceInputs(doc));
					checkbox.addEventListener("change", () => this.saveAttachmentPreferenceInputs(doc));
				}
			}
		},

		schedulePreferenceAutoSave(doc) {
			let win = doc?.defaultView || Zotero.getMainWindow();
			if (this._preferenceAutoSaveTimer && win?.clearTimeout) {
				win.clearTimeout(this._preferenceAutoSaveTimer);
			}
			let save = () => this.saveAttachmentPreferenceInputs(doc);
			this._preferenceAutoSaveTimer = win?.setTimeout
				? win.setTimeout(save, 600)
				: setTimeout(save, 600);
		},

		saveAttachmentPreferenceInputs(doc) {
			try {
				let root = doc.getElementById("zotlink-move-root")?.value?.trim() || "";
				let shortcutInput = doc.getElementById("zotlink-move-shortcut");
				let shortcut = this.normalizeShortcutText(shortcutInput?.value?.trim() || "");
				let copyLinkShortcutInput = doc.getElementById("zotlink-copy-link-shortcut");
				let copyLinkShortcut = this.normalizeShortcutText(copyLinkShortcutInput?.value?.trim() || "");
				let copyObsidianLinkShortcutInput = doc.getElementById("zotlink-copy-obsidian-link-shortcut");
				let copyObsidianLinkShortcut = this.normalizeShortcutText(copyObsidianLinkShortcutInput?.value?.trim() || "");
				if (shortcutInput) {
					this.setInputValue(shortcutInput, shortcut);
				}
				if (copyLinkShortcutInput) {
					this.setInputValue(copyLinkShortcutInput, copyLinkShortcut);
				}
				if (copyObsidianLinkShortcutInput) {
					this.setInputValue(copyObsidianLinkShortcutInput, copyObsidianLinkShortcut);
				}
				if (!this.validateShortcutPreferences([
					{ label: "移动快捷键", shortcut },
					{ label: "复制 DOI/URL 链接快捷键", shortcut: copyLinkShortcut },
					{ label: "复制 Obsidian 文献链接快捷键", shortcut: copyObsidianLinkShortcut }
				])) {
					this.restoreShortcutPreferenceInputs(doc);
					return;
				}
				this.setPref("attachmentMoveRoot", root);
				this.setPref("attachmentMoveShortcut", shortcut);
				this.setPref("copyLinkShortcut", copyLinkShortcut);
				this.setPref("copyObsidianLinkShortcut", copyObsidianLinkShortcut);
				for (let [elementID, prefKey] of this.getPDFOperationPreferenceDefinitions()) {
					let checkbox = doc.getElementById(elementID);
					if (checkbox) {
						this.setPref(prefKey, Boolean(checkbox.checked));
					}
				}
				this.updateCurrentShortcutLabel(doc, shortcut);
				this.updateCurrentShortcutLabel(doc, copyLinkShortcut, "zotlink-current-copy-link-shortcut");
				this.updateCurrentShortcutLabel(doc, copyObsidianLinkShortcut, "zotlink-current-copy-obsidian-link-shortcut");
				this.registerShortcut();
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		validateShortcutPreferences(definitions) {
			let signatures = new Map();
			for (let definition of definitions) {
				if (!definition.shortcut) {
					continue;
				}
				let parsed = this.parseShortcut(definition.shortcut);
				if (!parsed) {
					this.showStatus(`${definition.label}无效`, 3000);
					return false;
				}
				let signature = this.shortcutSignature(parsed);
				if (signatures.has(signature)) {
					this.showStatus(`${definition.label}与${signatures.get(signature)}冲突`, 3500);
					return false;
				}
				signatures.set(signature, definition.label);
				let conflict = this.findShortcutConflict(definition.shortcut);
				if (conflict) {
					this.showStatus(`${definition.label}与已有快捷键冲突：${conflict}`, 4500);
					return false;
				}
			}
			return true;
		},

		restoreShortcutPreferenceInputs(doc) {
			let shortcuts = [
				["zotlink-move-shortcut", "attachmentMoveShortcut", "zotlink-current-shortcut"],
				["zotlink-copy-link-shortcut", "copyLinkShortcut", "zotlink-current-copy-link-shortcut"],
				["zotlink-copy-obsidian-link-shortcut", "copyObsidianLinkShortcut", "zotlink-current-copy-obsidian-link-shortcut"]
			];
			for (let [inputID, prefKey, labelID] of shortcuts) {
				let value = this.getPref(prefKey, "");
				this.setInputValue(doc.getElementById(inputID), value);
				this.updateCurrentShortcutLabel(doc, value, labelID);
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

			let copyItemLinkItem = doc.createXULElement("menuitem");
			copyItemLinkItem.setAttribute("label", "复制 DOI/URL 链接");
			copyItemLinkItem.addEventListener("command", () => this.copySelectedItemLink());
			popup.appendChild(copyItemLinkItem);

			let copyObsidianLinkItem = doc.createXULElement("menuitem");
			copyObsidianLinkItem.setAttribute("label", "复制 Obsidian 文献链接");
			copyObsidianLinkItem.addEventListener("command", () => this.copySelectedObsidianItemLink());
			popup.appendChild(copyObsidianLinkItem);

			popup.appendChild(doc.createXULElement("menuseparator"));

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

			let alignPDFPageLabelsItem = doc.createXULElement("menuitem");
			alignPDFPageLabelsItem.setAttribute("label", "对齐 PDF 页码");
			alignPDFPageLabelsItem.addEventListener("command", () => this.alignSelectedPDFPageLabels());
			popup.appendChild(alignPDFPageLabelsItem);

			let articleHistoryItem = doc.createXULElement("menuitem");
			articleHistoryItem.setAttribute("label", "提取文章历史时间线");
			articleHistoryItem.addEventListener("command", () => this.writeSelectedArticleHistory());
			popup.appendChild(articleHistoryItem);

			let repairAttachmentsItem = doc.createXULElement("menuitem");
			repairAttachmentsItem.setAttribute("label", "按机内码修复附件链接");
			repairAttachmentsItem.addEventListener("command", () => this.repairSelectedAttachmentLinksByFileID());
			popup.appendChild(repairAttachmentsItem);

			menu.appendChild(root);
			this._menuElements.push(root);
		},

		async copySelectedItemLink() {
			let itemResult = this.getSelectedRegularItemForLinkCopy();
			if (!itemResult.ok) {
				this.showStatus(itemResult.reason, 3000);
				return itemResult;
			}

			let link = this.getPreferredLiteratureLink(itemResult.item);
			if (!link.value) {
				this.showStatus("所选文献没有 DOI 或 URL", 3500);
				return { ok: false, reason: "所选文献没有 DOI 或 URL" };
			}

			try {
				await this.copyTextToClipboard(link.value);
				this.showStatus(`已复制 ${link.source} 链接`, 2500);
				return { ok: true, value: link.value, source: link.source };
			}
			catch (e) {
				Zotero.logError(e);
				this.showStatus("复制链接失败", 3500);
				return { ok: false, reason: this.errorToText(e) || "复制链接失败" };
			}
		},

		async copySelectedObsidianItemLink() {
			let itemResult = this.getSelectedRegularItemForLinkCopy();
			if (!itemResult.ok) {
				this.showStatus(itemResult.reason, 3000);
				return itemResult;
			}

			let item = itemResult.item;
			let link = this.getPreferredLiteratureLink(item);
			if (!link.value) {
				this.showStatus("所选文献没有 DOI 或 URL", 3500);
				return { ok: false, reason: "所选文献没有 DOI 或 URL" };
			}

			let attachment = itemResult.attachment && this.isPDFFilePath(itemResult.attachment.getFilePath?.(), itemResult.attachment)
				? itemResult.attachment
				: await this.getPrimaryPDFAttachmentForItem(item);
			let pdfLink = this.getZoteroOpenPDFLink(attachment);
			if (!pdfLink) {
				this.showStatus("所选文献没有可引用的主 PDF 附件", 3500);
				return { ok: false, reason: "所选文献没有可引用的主 PDF 附件" };
			}

			let value = `[🔗](${link.value}) [📚](${pdfLink})`;
			try {
				await this.copyTextToClipboard(value);
				this.showStatus("已复制 Obsidian 文献链接", 2500);
				return { ok: true, value, source: link.source, pdfLink };
			}
			catch (e) {
				Zotero.logError(e);
				this.showStatus("复制 Obsidian 文献链接失败", 3500);
				return { ok: false, reason: this.errorToText(e) || "复制 Obsidian 文献链接失败" };
			}
		},

		getSelectedRegularItemForLinkCopy() {
			let selectedItems = Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() || [];
			if (selectedItems.length !== 1) {
				return { ok: false, reason: "请只选择一篇文献" };
			}

			let item = selectedItems[0];
			let attachment = null;
			if (item?.isAttachment?.()) {
				attachment = item;
				item = item.parentItem;
			}
			if (!item?.isRegularItem?.()) {
				return { ok: false, reason: "所选内容不是文献条目" };
			}
			return { ok: true, item, attachment };
		},

		getPreferredLiteratureLink(item) {
			let doi = this.normalizeDOI(item?.getField?.("DOI"));
			let value = /^10\.\d{4,9}\/.+/i.test(doi) ? `https://doi.org/${doi}` : "";
			if (value) {
				return { value, source: "DOI" };
			}
			value = String(item?.getField?.("url") || item?.getField?.("URL") || "").trim();
			return { value, source: value ? "URL" : "" };
		},

		getZoteroOpenPDFLink(attachment) {
			if (!attachment?.key) {
				return "";
			}
			if (Number(attachment.libraryID) === Number(Zotero.Libraries.userLibraryID)) {
				return `zotero://open-pdf/library/items/${attachment.key}`;
			}
			try {
				let library = Zotero.Libraries.get(attachment.libraryID);
				let groupID = library?.libraryType === "group" ? library?.id : null;
				if (groupID) {
					return `zotero://open-pdf/groups/${groupID}/items/${attachment.key}`;
				}
			}
			catch (e) {
				Zotero.debug("ZotLink: failed to build group PDF link", 1);
			}
			return `zotero://open-pdf/library/items/${attachment.key}`;
		},

		async copyTextToClipboard(text) {
			let copy = Zotero.Utilities?.Internal?.copyTextToClipboard;
			if (typeof copy === "function") {
				await copy.call(Zotero.Utilities.Internal, text);
				return;
			}
			let components = typeof Components !== "undefined" ? Components : null;
			let helper = components?.classes?.["@mozilla.org/widget/clipboardhelper;1"]
				?.getService?.(components.interfaces.nsIClipboardHelper);
			if (!helper) {
				throw new Error("剪贴板服务不可用");
			}
			helper.copyString(text);
		},

		registerCollectionMenu(win) {
			let doc = win.document;
			let menu = this.getCollectionContextMenu(doc);
			if (!menu) {
				Zotero.debug("ZotLink: collection context menu not found", 1);
				this.registerCollectionMenuFallback(win);
				return;
			}

			this.appendCollectionMenu(doc, menu);
			this.registerCollectionMenuFallback(win);
		},

		appendCollectionMenu(doc, menu) {
			if (!doc || !menu || this.hasZotLinkCollectionMenu(menu)) {
				return false;
			}

			let root = doc.createXULElement("menu");
			root.id = `${COLLECTION_MENU_ID}-${this._menuElements.length + 1}`;
			root.setAttribute("data-zotlink-collection-menu", "true");
			root.setAttribute("label", PLUGIN_NAME);

			let popup = doc.createXULElement("menupopup");
			root.appendChild(popup);

			let importPDFsItem = doc.createXULElement("menuitem");
			importPDFsItem.setAttribute("label", "仅导入当前文件夹 PDF");
			this.attachCollectionImportMenuAction(importPDFsItem, { recursive: false });
			popup.appendChild(importPDFsItem);

			let importPDFsRecursiveItem = doc.createXULElement("menuitem");
			importPDFsRecursiveItem.setAttribute("label", "导入当前文件夹及子文件夹 PDF");
			this.attachCollectionImportMenuAction(importPDFsRecursiveItem, { recursive: true });
			popup.appendChild(importPDFsRecursiveItem);

			menu.appendChild(root);
			this._menuElements.push(root);
			return true;
		},

		hasZotLinkCollectionMenu(menu) {
			return Boolean(menu?.querySelector?.('[data-zotlink-collection-menu="true"]'));
		},

		attachCollectionImportMenuAction(menuItem, options) {
			let trigger = event => {
				if (event?.type === "click" && event.button !== 0) {
					return;
				}
				let now = Date.now();
				if (menuItem._zotlinkLastTriggerAt && now - menuItem._zotlinkLastTriggerAt < 500) {
					return;
				}
				menuItem._zotlinkLastTriggerAt = now;
				this.importPDFsFromSelectedCollectionFolder(options).catch(e => Zotero.logError(e));
			};
			menuItem.addEventListener("command", trigger);
			menuItem.addEventListener("click", trigger);
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
				if (!menu || this.hasZotLinkCollectionMenu(menu)) {
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
			for (let element of Array.from(doc.querySelectorAll?.('[data-zotlink-collection-menu="true"]') || [])) {
				element.remove();
			}
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
			for (let id of [ITEM_MENU_ID]) {
				doc.getElementById(id)?.remove();
			}
			for (let element of Array.from(doc.querySelectorAll?.('[data-zotlink-collection-menu="true"]') || [])) {
				element.remove();
			}
			this.unregisterCollectionMenuFallback(win);
			this._menuElements = this._menuElements.filter(element => element.ownerDocument !== doc);
		},

		registerShortcut(win) {
			if (!win) {
				for (let mainWindow of Zotero.getMainWindows()) {
					this.registerShortcut(mainWindow);
				}
				return;
			}

			let doc = win.document;
			this.unregisterWindowShortcuts(win);
			let keyset = doc.getElementById("mainKeyset") || doc.documentElement;
			let definitions = [
				{
					id: MOVE_SHORTCUT_KEY_ID,
					shortcut: String(this.getPref("attachmentMoveShortcut", "") || "").trim(),
					action: () => this.moveSelectedAttachmentsToCollectionPath()
				},
				{
					id: COPY_LINK_SHORTCUT_KEY_ID,
					shortcut: String(this.getPref("copyLinkShortcut", "") || "").trim(),
					action: () => this.copySelectedItemLink()
				},
				{
					id: COPY_OBSIDIAN_LINK_SHORTCUT_KEY_ID,
					shortcut: String(this.getPref("copyObsidianLinkShortcut", "") || "").trim(),
					action: () => this.copySelectedObsidianItemLink()
				}
			];
			let registered = [];
			let signatures = new Set();
			for (let definition of definitions) {
				if (!definition.shortcut) {
					continue;
				}
				let parsed = this.parseShortcut(definition.shortcut);
				let signature = this.shortcutSignature(parsed);
				if (!parsed || !signature || signatures.has(signature)) {
					Zotero.debug(`ZotLink: invalid or duplicate shortcut ${definition.shortcut}`, 1);
					continue;
				}
				signatures.add(signature);
				let keyset = doc.getElementById("mainKeyset") || doc.documentElement;
				let key = doc.createXULElement("key");
				key.id = definition.id;
				key.setAttribute(parsed.key.length === 1 ? "key" : "keycode", parsed.key);
				key.setAttribute("modifiers", parsed.modifiers.join(","));
				key.addEventListener("command", definition.action);
				keyset.appendChild(key);
				this._shortcutElements.push(key);
				registered.push({ parsed, action: definition.action });
			}

			let handler = event => {
				for (let definition of registered) {
					if (this.keyboardEventMatchesShortcut(event, definition.parsed)) {
						event.preventDefault();
						event.stopPropagation();
						definition.action();
						return;
					}
				}
			};
			if (registered.length) {
				doc.addEventListener("keydown", handler, true);
				this._shortcutHandlers.set(win, handler);
			}
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
					if ([MOVE_SHORTCUT_KEY_ID, COPY_LINK_SHORTCUT_KEY_ID, COPY_OBSIDIAN_LINK_SHORTCUT_KEY_ID].includes(keyElement.id)) {
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
			doc.getElementById(COPY_LINK_SHORTCUT_KEY_ID)?.remove();
			doc.getElementById(COPY_OBSIDIAN_LINK_SHORTCUT_KEY_ID)?.remove();
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
			let modeText = recursive ? "递归导入分类文件夹 PDF" : "导入当前分类文件夹 PDF";
			if (this._collectionPDFImportRunning) {
				this.showStatus(`ZotLink ${modeText}已在进行中`, 3500);
				return;
			}
			this._collectionPDFImportRunning = true;
			let startedAt = Date.now();
			try {
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

				let collectionPath = await this.getCollectionPathByIDAsync(collectionID);
				if (!collectionPath.length) {
					this.showSoftReport("无法解析当前 collection 的文件夹路径。");
					return;
				}

				let folderPath = PathUtils.join(root, ...collectionPath);
				if (!(await IOUtils.exists(folderPath))) {
					this.showSoftReport(`Collection 对应文件夹不存在：${folderPath}`, 8000);
					return;
				}

				let headline = recursive ? "正在递归导入分类文件夹 PDF" : "正在从当前分类文件夹导入 PDF";
				let progressWindow = null;
				let lastScanStatusAt = 0;
				let lastSoftStatusAt = 0;
				let recursiveStructure = null;
				let subcollectionDiagnosticPath = "";
				this.showSoftReport(`ZotLink - ${headline}：正在扫描文件夹...`, 5000);
				if (recursive) {
					this.updateProgressWindow(progressWindow, headline, "正在按磁盘子文件夹重建子分类结构...");
					recursiveStructure = await this.ensureSubcollectionStructureFromFolder(folderPath, collectionID, {
						onProgress: ({ directories, created }) => {
							let now = Date.now();
							if (directories === 1 || now - lastScanStatusAt >= 1200) {
								lastScanStatusAt = now;
								this.updateProgressWindow(progressWindow, headline, `正在确认子分类：已检查 ${directories || 0} 个文件夹，新增 ${created || 0} 个`);
							}
							if (directories === 1 || now - lastSoftStatusAt >= 5000) {
								lastSoftStatusAt = now;
								this.showSoftReport(`ZotLink - ${headline}：正在确认子分类，已检查 ${directories || 0} 个文件夹`, 4000);
							}
						}
					});
				if (this.shouldWriteSubcollectionDiagnostic(recursiveStructure)) {
					subcollectionDiagnosticPath = await this.writeTextReport("zotlink-subcollection-diagnostic", recursiveStructure.diagnostics.join("\n"));
				}
					this.refreshCollectionsPane();
					this.updateProgressWindow(progressWindow, headline, `子分类已确认：检查 ${recursiveStructure.directoryCount} 个文件夹，新增 ${recursiveStructure.created} 个，复用 ${recursiveStructure.reused || 0} 个；正在扫描 PDF...`);
				}
				let pdfEntries = recursive
					? await this.getPDFImportEntriesRecursive(folderPath, collectionID, {
						collectionCache: recursiveStructure?.collectionCache,
						childCollectionCache: recursiveStructure?.childCollectionCache,
						onProgress: ({ directories, pdfs, currentPath }) => {
							let now = Date.now();
							if (directories === 1 || now - lastScanStatusAt >= 1200) {
								lastScanStatusAt = now;
								this.updateProgressWindow(progressWindow, headline, `正在扫描第 ${directories || 0} 个文件夹，已找到 ${pdfs || 0} 个 PDF`);
							}
							if (directories === 1 || now - lastSoftStatusAt >= 5000) {
								lastSoftStatusAt = now;
								this.showSoftReport(`ZotLink - ${headline}：已找到 ${pdfs || 0} 个 PDF`, 4000);
							}
						}
					})
					: await this.getPDFImportEntriesShallow(folderPath, collectionID);
				let pdfs = pdfEntries.map(entry => entry.path);
				if (!pdfs.length) {
					this.updateProgressWindow(progressWindow, "PDF 导入完成", "未找到 PDF", 4000);
					this.closeProgressWindow(progressWindow);
					this.showSoftReport(`未在文件夹中找到 PDF：${folderPath}`, 8000);
					return;
				}

				let existingIdentifierCache = new Map();
				let isbnDiagnostics = [];
				let imported = 0;
				let linkedExisting = 0;
				let unchangedExisting = 0;
				let skipped = 0;
				let reasons = new Map();
				let skippedReasons = new Map();
				let importDiagnostics = [];
				let index = this.getAttachmentFileIndex();
				let fileIDItems = await this.getIndexedAttachmentItemMapByFileID(index);
				let pdfFileIDs = await this.getWindowsFileIDsWithPython(pdfs);
				this.updateProgressWindow(progressWindow, headline, `已扫描到 ${pdfs.length} 个 PDF；已处理 0 / ${pdfs.length}`);
				this.showSoftReport(`ZotLink - ${headline}：已扫描到 ${pdfs.length} 个 PDF，开始导入...`, 5000);

				for (let i = 0; i < pdfEntries.length; i++) {
					let entry = pdfEntries[i];
					let pdfPath = entry.path;
					let targetCollectionID = entry.collectionID || collectionID;
					try {
						let fileIDLocator = pdfFileIDs.get(this.normalizePathForCompare(pdfPath));
						let fileIDMatch = await this.findIndexedAttachmentItemByFileID(fileIDLocator?.fileID, fileIDItems);
						if (fileIDMatch?.itemID) {
							await this.refreshFileIDMatchedAttachmentPath(fileIDMatch.attachment, pdfPath, fileIDLocator.fileID, index);
							let added = await this.addExistingItemToCollection(fileIDMatch.itemID, targetCollectionID);
							let itemText = await this.formatImportItemDiagnostic(fileIDMatch.itemID);
							let collectionText = await this.formatImportCollectionDiagnostic(targetCollectionID);
							if (added) {
								linkedExisting++;
								this.countReason(reasons, "机内码命中已有附件，已加入目标分类");
								this.addImportDiagnostic(importDiagnostics, `归入：机内码命中已有附件，已加入目标分类；条目=${itemText}；分类=${collectionText}；PDF=${pdfPath}`);
							}
							else {
								unchangedExisting++;
								this.countReason(reasons, "机内码命中已有附件，已在目标分类");
								this.addImportDiagnostic(importDiagnostics, `已存在：机内码命中已有附件，已在目标分类；条目=${itemText}；分类=${collectionText}；PDF=${pdfPath}`);
							}
							continue;
						}

						let identifier = await this.extractIdentifierFromPDFMetadata(pdfPath);
						if (!identifier.value) {
							skipped++;
							this.countReason(reasons, "未发现 DOI/ISBN");
							this.countReason(skippedReasons, "未发现 DOI/ISBN");
							let fileIDText = fileIDLocator?.fileID
								? `机内码=${fileIDLocator.fileID}；机内码有效索引命中=否`
								: "机内码=未读取到";
							this.addImportDiagnostic(importDiagnostics, `跳过：未发现 DOI/ISBN；${fileIDText}；PDF=${pdfPath}`);
							continue;
						}
						let identifierKeys = this.normalizeIdentifierValues(identifier);
						let identifierKey = identifierKeys[0] || "";
						let existingItems = existingIdentifierCache.get(identifier.type);
						if (!existingItems) {
							existingItems = await this.getLibraryIdentifierItemMap(identifier.type);
							existingIdentifierCache.set(identifier.type, existingItems);
						}
						let existingItemID = identifierKeys.map(key => existingItems.get(key)).find(Boolean);
						if (existingItemID) {
							Zotero.debug(`ZotLink: skipped duplicate ${identifier.type.toUpperCase()} in library: ${identifierKey}`);
							let result = await this.attachOrMirrorPDFForExistingItem({
								itemID: existingItemID,
								pdfPath,
								collectionID: targetCollectionID,
								index
							});
							let itemText = await this.formatImportItemDiagnostic(existingItemID);
							let collectionText = await this.formatImportCollectionDiagnostic(targetCollectionID);
							if (result.addedToCollection || result.attachmentCreated || result.mirrorSynced) {
								linkedExisting++;
								this.countReason(reasons, `库中已存在 ${identifier.type.toUpperCase()}，已同步附件/分类`);
								this.addImportDiagnostic(importDiagnostics, `归入：库中已存在 ${identifier.type.toUpperCase()}，已同步附件/分类；条目=${itemText}；分类=${collectionText}；PDF=${pdfPath}`);
							}
							else {
								unchangedExisting++;
								this.countReason(reasons, `库中已存在 ${identifier.type.toUpperCase()}，已在目标分类`);
								this.addImportDiagnostic(importDiagnostics, `已存在：库中已存在 ${identifier.type.toUpperCase()}，已在目标分类；条目=${itemText}；分类=${collectionText}；PDF=${pdfPath}`);
							}
							continue;
						}
						if (identifier.type === "isbn" && isbnDiagnostics.length < 5) {
							isbnDiagnostics.push(await this.buildISBNDuplicateDiagnostic(pdfPath, identifier, identifierKeys, existingItems));
						}

						let item = await this.createLinkedPDFItemFromIdentifier({
							identifier,
							pdfPath,
							collectionID: targetCollectionID,
							index
						});
						if (item) {
							for (let key of identifierKeys) {
								if (key && !existingItems.has(key)) {
									existingItems.set(key, item.id);
								}
							}
							imported++;
						}
						else {
							skipped++;
							this.countReason(reasons, "创建条目失败");
							this.countReason(skippedReasons, "创建条目失败");
							this.addImportDiagnostic(importDiagnostics, `失败：创建条目返回空；${identifier.type.toUpperCase()}=${identifier.value}；PDF=${pdfPath}`);
						}
					}
					catch (e) {
						Zotero.logError(e);
						skipped++;
						this.countReason(reasons, e.message || "异常");
						this.countReason(skippedReasons, e.message || "异常");
						this.addImportDiagnostic(importDiagnostics, `异常：${this.errorToText(e) || e}；PDF=${pdfPath}`);
					}

					let processed = i + 1;
					if (processed === 1 || processed === pdfs.length || processed % 5 === 0) {
						this.updateProgressWindow(progressWindow, headline, `已处理 ${processed} / ${pdfs.length}，已导入 ${imported}，已归入 ${linkedExisting}，已存在 ${unchangedExisting}，跳过 ${skipped}`);
						let now = Date.now();
						if (processed === 1 || processed === pdfs.length || now - lastSoftStatusAt >= 5000) {
							lastSoftStatusAt = now;
							this.showSoftReport(`ZotLink - ${headline}：已处理 ${processed} / ${pdfs.length}`, 4000);
						}
					}
				}

				this.setAttachmentFileIndex(index);
				let skippedReasonText = this.formatReasons(skippedReasons);
				this.updateProgressWindow(progressWindow, "PDF 导入完成", `已导入 ${imported}，已归入 ${linkedExisting}，已存在 ${unchangedExisting}，跳过 ${skipped}`, 1200);
				if (isbnDiagnostics.length) {
					await this.writeTextReport("zotlink-isbn-diagnostic", isbnDiagnostics.join("\n\n---\n\n"));
				}
				if (importDiagnostics.length) {
					await this.writeTextReport("zotlink-import-diagnostic", importDiagnostics.join("\n"));
				}
				let seconds = Math.round((Date.now() - startedAt) / 1000);
				this.closeProgressWindow(progressWindow);
				this.showCollectionImportCompletion(`${modeText}完成：共检查 ${pdfs.length} 个 PDF，已新建 ${imported} 个，已归入已有条目 ${linkedExisting} 个${unchangedExisting ? `，已存在无需处理 ${unchangedExisting} 个` : ""}${skipped ? `，跳过 ${skipped} 个${skippedReasonText ? "：" + skippedReasonText : ""}` : ""}。耗时约 ${seconds} 秒。`);
			}
			finally {
				this._collectionPDFImportRunning = false;
			}
		},

		showCollectionImportCompletion(message) {
			let useAlert = this.getBoolPref("useAlertForCollectionImportCompletion", false);
			if (useAlert) {
				this.showAlert("ZotLink 导入完成", message);
			}
			else {
				this.showSoftReport(`ZotLink 导入完成：${message}`, 9000);
			}
		},

		addImportDiagnostic(lines, message) {
			if (!Array.isArray(lines)) {
				return;
			}
			if (lines.length < 1000) {
				lines.push(message);
			}
		},

		async formatImportItemDiagnostic(itemID) {
			let id = Number(itemID) || 0;
			let item = null;
			try {
				item = id ? await Zotero.Items.getAsync(id) : null;
			}
			catch (e) {
				Zotero.logError(e);
			}
			let title = this.getItemDisplayName(item) || "未知条目";
			let year = "";
			try {
				year = String(item?.getField?.("year") || item?.getField?.("date") || "").trim();
			}
			catch (e) {
				year = "";
			}
			let key = item?.key ? `；key=${item.key}` : "";
			let yearText = year ? `；年份=${year}` : "";
			return `${title}${yearText}${key}；itemID=${id || itemID}`;
		},

		async formatImportCollectionDiagnostic(collectionID) {
			let id = Number(collectionID) || 0;
			let path = [];
			try {
				path = id ? await this.getCollectionPathByIDAsync(id) : [];
			}
			catch (e) {
				Zotero.logError(e);
			}
			return `${path.length ? path.join("/") : "未知分类"}；collectionID=${id || collectionID}`;
		},

		shouldWriteSubcollectionDiagnostic(structure) {
			if (!structure?.diagnostics?.length || !structure?.writeDiagnostic) {
				return false;
			}
			return structure.diagnostics.some(line => /失败|异常|无法/.test(String(line || "")));
		},

		async importPDFsFromAttachmentRootFolder(options = {}) {
			let root = this.getAttachmentMoveRoot();
			if (!root) {
				root = this.promptForAttachmentMoveRoot();
				if (!root) {
					this.showSoftReport("请先在设置中填写附件移动顶层路径");
					return;
				}
			}
			if (!(await IOUtils.exists(root))) {
				this.showSoftReport(`附件顶层路径不存在：${root}`, 8000);
				return;
			}
			await this.repairAllLibraryAttachmentLinksByFileID({ silent: true });

			let headline = "正在从顶层文件夹重建链接库";
			let useProgressWindow = options.useProgressWindow !== false;
			let softProgress = options.softProgress !== false;
			let progressWindow = useProgressWindow
				? this.createProgressWindow(headline, "正在扫描文件夹并重建 collection 结构")
				: null;
			let lastSoftProgressAt = 0;
			let notifyProgress = (title, message, buttonLabel = "", closeAfter = 2500, force = false) => {
				options.onStage?.({
					title,
					message,
					buttonLabel
				});
				this.updateProgressWindow(progressWindow, title, message);
				let now = Date.now();
				if (softProgress && (force || now - lastSoftProgressAt >= 2500)) {
					lastSoftProgressAt = now;
					this.showStatus(`${title}：${message}`, closeAfter);
				}
			};

			notifyProgress(headline, "正在重建 collection 文件夹结构", "重建结构...", 2500, true);
			let structure = await this.rebuildCollectionStructureFromRoot(root, {
				onProgress: ({ directories, currentPath }) => {
					options.onScanProgress?.({
						directories,
						pdfs: 0,
						currentPath
					});
					notifyProgress(
						"正在重建 collection 结构",
						`已确认 ${directories} 个文件夹`,
						`重建 ${directories} 夹`
					);
				}
			});

			notifyProgress(
				headline,
				`collection 结构已确认：磁盘 ${structure.directoryCount} 个文件夹，collection 补齐 ${structure.folderCheckedCount} 个文件夹，新增 ${structure.folderCreatedCount} 个；正在扫描 PDF 文件`,
				"扫描 PDF...",
				2500,
				true
			);
			let pdfEntries = await this.scanPDFImportEntriesFromRoot(root, structure.collectionCache, {
				onProgress: ({ directories, pdfs, currentPath }) => {
					options.onScanProgress?.({
						directories,
						pdfs,
						currentPath
					});
					notifyProgress(
						"正在扫描 PDF 文件",
						`已扫描 ${directories} 个文件夹，发现 ${pdfs} 个 PDF`,
						`PDF ${pdfs}`
					);
				}
			});
			if (!pdfEntries.length) {
				this.updateProgressWindow(progressWindow, "链接库重建完成", "未找到 PDF", 4000);
				this.showSoftReport(`未在顶层路径中找到 PDF：${root}`, 8000);
				return;
			}

			notifyProgress(
				headline,
				`已找到 ${pdfEntries.length} 个 PDF；正在读取库中已有 DOI/ISBN`,
				"读取已有标识符...",
				3000,
				true
			);
			let existingLibraryIdentifiers = {
				doi: await this.getLibraryIdentifierSet("doi"),
				isbn: await this.getLibraryIdentifierSet("isbn")
			};
			let imported = 0;
			let skipped = 0;
			let reasons = new Map();
			let index = this.getAttachmentFileIndex();

			notifyProgress(
				headline,
				`开始导入：已处理 0 / ${pdfEntries.length}，已导入 0，跳过 0`,
				`正在导入 0/${pdfEntries.length}`,
				2500,
				true
			);

			for (let i = 0; i < pdfEntries.length; i++) {
				let entry = pdfEntries[i];
				try {
					let identifier = await this.extractIdentifierFromPDFMetadata(entry.path);
					if (!identifier.value) {
						skipped++;
						this.countReason(reasons, "未发现 DOI/ISBN");
						continue;
					}
					let identifierKey = this.normalizeIdentifierValue(identifier);
					let existingIdentifiers = existingLibraryIdentifiers[identifier.type] || new Set();
					if (existingIdentifiers.has(identifierKey)) {
						skipped++;
						this.countReason(reasons, `库中已存在 ${identifier.type.toUpperCase()}`);
						continue;
					}

					let item = await this.createLinkedPDFItemFromIdentifier({
						identifier,
						pdfPath: entry.path,
						collectionID: entry.collectionID,
						index
					});
					if (item) {
						existingIdentifiers.add(identifierKey);
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
				if (processed === 1 || processed === pdfEntries.length || processed % 5 === 0) {
					options.onProgress?.({
						processed,
						total: pdfEntries.length,
						imported,
						skipped
					});
					notifyProgress(
						headline,
						`已处理 ${processed} / ${pdfEntries.length}，已导入 ${imported}，跳过 ${skipped}`,
						`正在导入 ${processed}/${pdfEntries.length}`
					);
				}
			}

			this.setAttachmentFileIndex(index);
			let reasonText = this.formatReasons(reasons);
			this.updateProgressWindow(progressWindow, "链接库重建完成", `已导入 ${imported}，跳过 ${skipped}`, 5000);
			this.showSoftReport(`顶层文件夹链接库重建完成：已确认磁盘文件夹 ${structure.directoryCount} 个，按现有 collection 补齐文件夹 ${structure.folderCreatedCount} 个；共检查 ${pdfEntries.length} 个 PDF，已导入 ${imported} 个${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。`, 8000);
		},

		async rebuildCollectionStructureFromRoot(rootPath, options = {}) {
			let folderSync = await this.ensureFolderStructureFromCollections(rootPath, {
				onProgress: options.onProgress
			});
			let collectionCache = new Map();
			collectionCache.set("", null);
			let childCollectionCache = new Map();
			let directoryCount = 0;
			let stack = [{
				dir: rootPath,
				relativeSegments: []
			}];
			while (stack.length) {
				let current = stack.pop();
				directoryCount++;
				await this.ensureCollectionPath(null, current.relativeSegments, collectionCache, childCollectionCache);
				if (directoryCount === 1 || directoryCount % 10 === 0) {
					options.onProgress?.({
						directories: directoryCount,
						currentPath: current.dir
					});
				}
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
				}
			}
			options.onProgress?.({
				directories: directoryCount,
				currentPath: rootPath
			});
			return {
				directoryCount,
				collectionCache,
				folderCreatedCount: folderSync.created,
				folderCheckedCount: folderSync.checked
			};
		},

		async ensureFolderStructureFromCollections(rootPath, options = {}) {
			let collections = Zotero.Collections.getByLibrary
				? Zotero.Collections.getByLibrary(Zotero.Libraries.userLibraryID)
				: [];
			if (!collections?.length) {
				return { checked: 0, created: 0 };
			}

			let byID = new Map();
			for (let collection of collections) {
				if (collection?.id) {
					byID.set(Number(collection.id), collection);
				}
			}

			let checked = 0;
			let created = 0;
			let seenPaths = new Set();
			for (let collection of collections) {
				let segments = this.getCollectionSegmentsFromMap(collection, byID);
				if (!segments.length) {
					continue;
				}
				let folderPath = PathUtils.join(rootPath, ...segments);
				let normalizedPath = this.normalizePathForCompare(folderPath);
				if (seenPaths.has(normalizedPath)) {
					continue;
				}
				seenPaths.add(normalizedPath);
				checked++;
				if (!(await IOUtils.exists(folderPath))) {
					await IOUtils.makeDirectory(folderPath, { createAncestors: true });
					created++;
				}
				if (checked === 1 || checked % 10 === 0) {
					options.onProgress?.({
						directories: checked,
						currentPath: folderPath
					});
				}
			}
			return { checked, created };
		},

		getCollectionSegmentsFromMap(collection, byID) {
			let segments = [];
			let current = collection;
			let guard = new Set();
			while (current?.id && !guard.has(Number(current.id))) {
				guard.add(Number(current.id));
				if (current.name) {
					segments.unshift(String(current.name));
				}
				let parentID = current.parentID ? Number(current.parentID) : null;
				current = parentID ? byID.get(parentID) : null;
			}
			return segments;
		},

		async scanPDFImportEntriesFromRoot(rootPath, collectionCache, options = {}) {
			let entries = [];
			let directoryCount = 0;
			let stack = [{
				dir: rootPath,
				relativeSegments: []
			}];
			while (stack.length) {
				let current = stack.pop();
				directoryCount++;
				let key = (current.relativeSegments || []).join("\u001f");
				let collectionID = collectionCache?.has(key) ? collectionCache.get(key) : null;
				if (directoryCount === 1 || directoryCount % 20 === 0) {
					options.onProgress?.({
						directories: directoryCount,
						pdfs: entries.length,
						currentPath: current.dir
					});
				}
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
							relativeSegments: current.relativeSegments,
							collectionID
						});
						if (entries.length === 1 || entries.length % 25 === 0) {
							options.onProgress?.({
								directories: directoryCount,
								pdfs: entries.length,
								currentPath: current.dir
							});
						}
					}
				}
			}
			options.onProgress?.({
				directories: directoryCount,
				pdfs: entries.length,
				currentPath: rootPath
			});
			return entries;
		},

		async getPDFImportPlanFromRoot(rootPath, options = {}) {
			let structure = await this.rebuildCollectionStructureFromRoot(rootPath, options);
			let entries = await this.scanPDFImportEntriesFromRoot(rootPath, structure.collectionCache, options);
			return {
				entries,
				directoryCount: structure.directoryCount
			};
		},

		async getPDFImportEntriesFromRoot(rootPath) {
			let plan = await this.getPDFImportPlanFromRoot(rootPath);
			return plan.entries;
		},

		async getPDFImportEntriesShallow(folderPath, collectionID) {
			let children = await IOUtils.getChildren(folderPath);
			let entries = [];
			for (let child of children) {
				try {
					let stat = await IOUtils.stat(child);
					if (this.isRegularFileStat(stat) && /\.pdf$/i.test(child)) {
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

		async getPDFImportEntriesRecursive(folderPath, collectionID, options = {}) {
			let entries = [];
			let directoryCount = 0;
			let collectionCache = options.collectionCache || new Map();
			if (!collectionCache.has("")) {
				collectionCache.set("", collectionID);
			}
			let childCollectionCache = options.childCollectionCache || new Map();
			let stack = [{
				dir: folderPath,
				relativeSegments: []
			}];
			while (stack.length) {
				let current = stack.pop();
				directoryCount++;
				let currentCollectionID = await this.ensureCollectionPath(collectionID, current.relativeSegments, collectionCache, childCollectionCache);
				if (directoryCount === 1 || directoryCount % 5 === 0) {
					options.onProgress?.({
						directories: directoryCount,
						pdfs: entries.length,
						currentPath: current.dir
					});
				}
				let children;
				try {
					children = await IOUtils.getChildren(current.dir);
				}
				catch (e) {
					Zotero.logError(e);
					continue;
				}

				for (let child of children) {
					let stat = null;
					try {
						stat = await IOUtils.stat(child);
					}
					catch (e) {
						Zotero.logError(e);
					}
					let isDirectory = await this.isDirectoryPath(child, stat);
					if (isDirectory) {
						stack.push({
							dir: child,
							relativeSegments: current.relativeSegments.concat([PathUtils.filename(child)])
						});
					}
					else if ((this.isRegularFileStat(stat) || !stat) && /\.pdf$/i.test(child)) {
						entries.push({
							path: child,
							collectionID: currentCollectionID
						});
						if (entries.length === 1 || entries.length % 25 === 0) {
							options.onProgress?.({
								directories: directoryCount,
								pdfs: entries.length,
								currentPath: current.dir
							});
						}
					}
				}
			}
			options.onProgress?.({
				directories: directoryCount,
				pdfs: entries.length,
				currentPath: folderPath
			});
			return entries;
		},

		async ensureSubcollectionStructureFromFolder(folderPath, collectionID, options = {}) {
			let collectionCache = new Map();
			collectionCache.set("", collectionID);
			let childCollectionCache = new Map();
			let stats = { checked: 0, created: 0, reused: 0, diagnostics: [], forceCreateSubcollections: false, writeDiagnostic: false };
			this.addSubcollectionDiagnostic(stats, `开始：rootCollectionID=${collectionID}；folder=${folderPath}`);
			let directoryCount = 0;
			let stack = [{
				dir: folderPath,
				relativeSegments: []
			}];
			while (stack.length) {
				let current = stack.pop();
				directoryCount++;
				await this.ensureCollectionPath(collectionID, current.relativeSegments, collectionCache, childCollectionCache, stats);
				if (directoryCount === 1 || directoryCount % 5 === 0) {
					options.onProgress?.({
						directories: directoryCount,
						checked: stats.checked,
						created: stats.created,
						currentPath: current.dir
					});
				}
				let children;
				try {
					children = await IOUtils.getChildren(current.dir);
					this.addSubcollectionDiagnostic(stats, `扫描目录：relative=${current.relativeSegments.join("/") || "."}；path=${current.dir}；children=${children.length}`);
				}
				catch (e) {
					Zotero.logError(e);
					this.addSubcollectionDiagnostic(stats, `失败：无法读取目录；relative=${current.relativeSegments.join("/") || "."}；path=${current.dir}；error=${this.errorToText(e) || e}`);
					continue;
				}
				for (let child of children) {
					let stat = null;
					try {
						stat = await IOUtils.stat(child);
					}
					catch (e) {
						Zotero.logError(e);
						this.addSubcollectionDiagnostic(stats, `提示：stat 失败，继续尝试目录读取；path=${child}；error=${this.errorToText(e) || e}`);
					}
					if (await this.isDirectoryPath(child, stat)) {
						this.addSubcollectionDiagnostic(stats, `发现子文件夹：parentRelative=${current.relativeSegments.join("/") || "."}；name=${PathUtils.filename(child)}；path=${child}`);
						stack.push({
							dir: child,
							relativeSegments: current.relativeSegments.concat([PathUtils.filename(child)])
						});
					}
					else if (!stat && !/\.[^\\/]+$/i.test(PathUtils.filename(child))) {
						stats.diagnostics?.push?.(`跳过：无法确认是否为文件夹；path=${child}`);
					}
				}
			}
			options.onProgress?.({
				directories: directoryCount,
				checked: stats.checked,
				created: stats.created,
				currentPath: folderPath
			});
			return {
				directoryCount,
				checked: stats.checked,
				created: stats.created,
				reused: stats.reused,
				diagnostics: stats.diagnostics,
				writeDiagnostic: Boolean(stats.writeDiagnostic || stats.diagnostics.length),
				collectionCache,
				childCollectionCache
			};
		},

		addSubcollectionDiagnostic(stats, message) {
			if (!stats?.diagnostics) {
				return;
			}
			if (stats.diagnostics.length < 800) {
				stats.diagnostics.push(message);
			}
		},

		refreshCollectionsPane() {
			try {
				let pane = Zotero.getActiveZoteroPane?.();
				pane?.collectionsView?.refresh?.();
				pane?.collectionsView?.invalidate?.();
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		refreshZoteroUIAfterImport() {
			try {
				let win = Zotero.getMainWindow?.();
				let pane = Zotero.getActiveZoteroPane?.();
				pane?.collectionsView?.refresh?.();
				pane?.collectionsView?.invalidate?.();
				pane?.itemsView?.refreshAndMaintainSelection?.();
				win?.focus?.();
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		isDirectoryStat(stat) {
			return Boolean(stat && (stat.type === "directory" || stat.type === "dir" || stat.isDirectory === true));
		},

		isRegularFileStat(stat) {
			return Boolean(stat && (stat.type === "regular" || stat.type === "file" || stat.isFile === true));
		},

		async isDirectoryPath(path, stat = null) {
			if (this.isDirectoryStat(stat)) {
				return true;
			}
			try {
				await IOUtils.getChildren(path);
				return true;
			}
			catch (e) {
				return this.isDirectoryPathWithPython(path);
			}
		},

		async isDirectoryPathWithPython(path) {
			let scriptPath = this.getTempTextPath("zotlink-isdir").replace(/\.txt$/i, ".py");
			let outputPath = this.getTempTextPath("zotlink-isdir-output");
			let script = [
				"import os, sys",
				"path, output = sys.argv[1], sys.argv[2]",
				"with open(output, 'w', encoding='utf-8') as f:",
				"    f.write('1' if os.path.isdir(path) else '0')"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(script));
				for (let command of ["C:\\Windows\\pyw.exe", "C:\\Windows\\py.exe"]) {
					let result = await this.execDiagnosticCommand(command, [
						"-3",
						scriptPath,
						path,
						outputPath
					], outputPath);
					let text = String(result.text || "").trim();
					if (text === "1") {
						return true;
					}
					if (text === "0") {
						return false;
					}
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
			finally {
				for (let tempPath of [scriptPath, outputPath]) {
					try {
						if (await IOUtils.exists(tempPath)) {
							await IOUtils.remove(tempPath);
						}
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
			}
			return false;
		},

		async ensureCollectionPath(rootCollectionID, relativeSegments, cache = new Map(), childCache = new Map(), stats = null) {
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
				let childKey = `${parentID || "root"}\u001f${this.normalizeCollectionNameForMatch(name)}`;
				if (cache.has(childKey)) {
					parentID = cache.get(childKey);
					continue;
				}
				parentID = await this.ensureChildCollection(parentID, name, childCache, stats);
				cache.set(childKey, parentID);
			}
			cache.set(key, parentID);
			return parentID;
		},

		async ensureChildCollection(parentID, name, cache = new Map(), stats = null) {
			parentID = parentID ? Number(parentID) : null;
			let normalizedName = this.normalizeCollectionNameForMatch(name);
			let cacheKey = `${parentID || "root"}\u001f${normalizedName}`;
			if (cache.has(cacheKey)) {
				return cache.get(cacheKey);
			}

			let parent = parentID ? Zotero.Collections.get(parentID) : null;
			let libraryID = parent?.libraryID || Zotero.Libraries.userLibraryID;
			if (stats) {
				stats.checked = Number(stats.checked || 0) + 1;
			}
			if (!stats?.forceCreateSubcollections) {
				let child = await this.findChildCollectionByName(parentID, name, stats);
				if (child) {
					this.addSubcollectionDiagnostic(stats, `复用：parent=${parentID || "root"}；name=${name}；id=${child.id}`);
					if (stats) {
						stats.reused = Number(stats.reused || 0) + 1;
						stats.writeDiagnostic = true;
					}
					cache.set(cacheKey, child.id);
					return child.id;
				}
			}

			let collection = new Zotero.Collection();
			collection.libraryID = libraryID;
			collection.name = name;
			if (parentID) {
				collection.parentID = parentID;
				if (parent?.key) {
					collection.parentKey = parent.key;
				}
				collection.parentCollectionID = parentID;
			}
			let savedID = await collection.saveTx();
			let collectionID = Number(savedID || collection.id) || 0;
			if (!collectionID) {
				let saved = await this.findChildCollectionByName(parentID, name, stats);
				collectionID = Number(saved?.id) || 0;
			}
			if (!collectionID) {
				this.addSubcollectionDiagnostic(stats, `失败：parent=${parentID || "root"}；name=${name}；saveTx=${savedID || ""}`);
				throw new Error(`无法创建 subcollection：${name}`);
			}
			if (stats) {
				stats.created = Number(stats.created || 0) + 1;
				stats.writeDiagnostic = true;
				this.addSubcollectionDiagnostic(stats, `新建：parent=${parentID || "root"}；name=${name}；id=${collectionID}`);
			}
			cache.set(cacheKey, collectionID);
			return collectionID;
		},

		async findChildCollectionByName(parentID, name, stats = null) {
			parentID = parentID ? Number(parentID) : null;
			let target = this.normalizeCollectionNameForMatch(name);
			let sql = parentID
				? "SELECT collectionID AS id, collectionName AS name, parentCollectionID AS parentID FROM collections WHERE libraryID=? AND parentCollectionID=?"
				: "SELECT collectionID AS id, collectionName AS name, parentCollectionID AS parentID FROM collections WHERE libraryID=? AND parentCollectionID IS NULL";
			let params = parentID
				? [Zotero.Libraries.userLibraryID, parentID]
				: [Zotero.Libraries.userLibraryID];
			let rows = await Zotero.DB.queryAsync(sql, params);
			for (let row of rows || []) {
				let collectionName = row.name || row.NAME || row.collectionName || row.collectionname || row[1] || "";
				if (this.normalizeCollectionNameForMatch(collectionName) !== target) {
					continue;
				}
				let collectionID = row.id || row.ID || row.collectionID || row.collectionid || row[0];
				if (await this.isDeletedCollectionID(collectionID)) {
					this.addSubcollectionDiagnostic(stats, `跳过回收站 collection：parent=${parentID || "root"}；name=${collectionName}；id=${collectionID}`);
					if (stats) {
						stats.writeDiagnostic = true;
					}
					continue;
				}
				let collection = collectionID ? Zotero.Collections.get(Number(collectionID)) : null;
				return collection || { id: Number(collectionID), name: collectionName, parentID };
			}
			return null;
		},

		async isDeletedCollectionID(collectionID) {
			collectionID = Number(collectionID) || 0;
			if (!collectionID) {
				return false;
			}
			try {
				let collection = Zotero.Collections.get(collectionID);
				if (collection?.deleted || collection?.isDeleted || collection?.inTrash) {
					return true;
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
			try {
				if (this._hasDeletedCollectionsTable === undefined) {
					let tables = await Zotero.DB.queryAsync(
						"SELECT name FROM sqlite_master WHERE type='table' AND name='deletedCollections'"
					);
					this._hasDeletedCollectionsTable = Boolean(tables?.length);
				}
				if (!this._hasDeletedCollectionsTable) {
					return false;
				}
				let rows = await Zotero.DB.queryAsync(
					"SELECT collectionID FROM deletedCollections WHERE collectionID=? LIMIT 1",
					[collectionID]
				);
				return Boolean(rows?.length);
			}
			catch (e) {
				Zotero.logError(e);
				return false;
			}
		},

		async isDeletedItemID(itemID) {
			itemID = Number(itemID) || 0;
			if (!itemID) {
				return false;
			}
			try {
				let item = await Zotero.Items.getAsync(itemID);
				if (item?.deleted || item?.isDeleted || item?.inTrash) {
					return true;
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
			try {
				let rows = await Zotero.DB.queryAsync(
					"SELECT itemID FROM deletedItems WHERE itemID=? LIMIT 1",
					[itemID]
				);
				return Boolean(rows?.length);
			}
			catch (e) {
				Zotero.logError(e);
				return false;
			}
		},

		async getCollectionParentID(collection) {
			if (!collection) {
				return null;
			}
			let objectParentID = this.getCollectionParentIDValue(collection);
			if (objectParentID) {
				return objectParentID;
			}
			if (collection.parentKey && Zotero.Collections.getByLibraryAndKey) {
				let parent = Zotero.Collections.getByLibraryAndKey(collection.libraryID || Zotero.Libraries.userLibraryID, collection.parentKey);
				if (parent?.id) {
					return Number(parent.id);
				}
			}
			if (collection.id) {
				try {
					let rows = await Zotero.DB.queryAsync(
						"SELECT parentCollectionID FROM collections WHERE collectionID=?",
						[Number(collection.id)]
					);
					let row = rows?.[0];
					let parentID = row?.parentCollectionID || row?.parentcollectionid || row?.[0] || null;
					return parentID ? Number(parentID) : null;
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			return null;
		},

		getCollectionParentIDValue(collection) {
			if (!collection) {
				return null;
			}
			let parentID = collection.parentID || collection.parentCollectionID || null;
			parentID = Number(parentID);
			return Number.isInteger(parentID) && parentID > 0 ? parentID : null;
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
						await this.runAutomaticPDFOperations(attachment);
						moved++;
					}
					else {
						if (result.indexable) {
							await this.indexAttachmentFileID(attachment, { quiet: true });
							await this.syncAttachmentMirrors(attachment);
							await this.runAutomaticPDFOperations(attachment);
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
			return this.getCollectionIdentifierSet(collectionID, "doi");
		},

		async getLibraryDOISet() {
			return this.getLibraryIdentifierSet("doi");
		},

		async getCollectionIdentifierSet(collectionID, type) {
			let values = new Set();
			let fieldName = this.getIdentifierFieldName(type);
			if (!fieldName) {
				return values;
			}
			let rows = await Zotero.DB.queryAsync(
				"SELECT IDV.value AS fieldValue FROM collectionItems CI JOIN items I ON CI.itemID=I.itemID JOIN itemData ID ON I.itemID=ID.itemID JOIN fields F ON ID.fieldID=F.fieldID JOIN itemDataValues IDV ON ID.valueID=IDV.valueID LEFT JOIN deletedItems DI ON CI.itemID=DI.itemID WHERE CI.collectionID=? AND I.libraryID=? AND DI.itemID IS NULL AND F.fieldName=?",
				[collectionID, Zotero.Libraries.userLibraryID, fieldName]
			);
			for (let row of rows) {
				try {
					let value = row.fieldValue || row.value || row[0];
					for (let normalized of this.normalizeIdentifierValues({ type, value })) {
						values.add(normalized);
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			return values;
		},

		async getLibraryIdentifierSet(type) {
			let values = new Set();
			let map = await this.getLibraryIdentifierItemMap(type);
			for (let value of map.keys()) {
				values.add(value);
			}
			return values;
		},

		async getIndexedAttachmentItemMapByFileID(index = null) {
			index = index || this.getAttachmentFileIndex();
			let map = new Map();
			for (let record of Object.values(index || {})) {
				if (!record?.fileID) {
					continue;
				}
				try {
					let attachment = await this.getIndexedAttachment(record);
					if (!attachment?.isFileAttachment?.()) {
						continue;
					}
					let parent = attachment.parentItem;
					if (!parent?.isRegularItem?.()) {
						continue;
					}
					if (await this.isDeletedItemID(attachment.id) || await this.isDeletedItemID(parent.id)) {
						continue;
					}
					for (let key of this.getFileIDLookupKeys(record.fileID)) {
						if (key && !map.has(key)) {
							map.set(key, { attachment, itemID: parent.id });
						}
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			return map;
		},

		async findIndexedAttachmentItemByFileID(fileID, fileIDItems) {
			if (!fileID || !fileIDItems?.size) {
				return null;
			}
			for (let key of this.getFileIDLookupKeys(fileID)) {
				let match = fileIDItems.get(key);
				if (match?.attachment?.isFileAttachment?.()
					&& match.itemID
					&& !(await this.isDeletedItemID(match.attachment.id))
					&& !(await this.isDeletedItemID(match.itemID))) {
					return match;
				}
			}
			return null;
		},

		async refreshFileIDMatchedAttachmentPath(attachment, pdfPath, fileID, index) {
			if (!attachment?.isFileAttachment?.() || !pdfPath || !fileID) {
				return false;
			}
			let currentPath = attachment.getFilePath?.() || "";
			if (currentPath && await IOUtils.exists(currentPath)) {
				return false;
			}
			await this.updateAttachmentLinkedPath(attachment, pdfPath);
			this.recordAttachmentFileID(attachment, pdfPath, fileID, {
				index,
				save: false
			});
			return true;
		},

		async getLibraryIdentifierItemMap(type) {
			let values = new Map();
			let fieldName = this.getIdentifierFieldName(type);
			if (!fieldName) {
				return values;
			}
			let rows = await Zotero.DB.queryAsync(
				"SELECT I.itemID AS itemID, IDV.value AS fieldValue FROM items I JOIN itemData ID ON I.itemID=ID.itemID JOIN fields F ON ID.fieldID=F.fieldID JOIN itemDataValues IDV ON ID.valueID=IDV.valueID LEFT JOIN deletedItems DI ON I.itemID=DI.itemID WHERE I.libraryID=? AND DI.itemID IS NULL AND F.fieldName=?",
				[Zotero.Libraries.userLibraryID, fieldName]
			);
			for (let row of rows) {
				try {
					let value = row.fieldValue || row.value || row[1] || "";
					let itemID = Number(row.itemID || row[0]);
					for (let normalized of this.normalizeIdentifierValues({ type, value })) {
						if (normalized && itemID && !values.has(normalized)) {
							values.set(normalized, itemID);
						}
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			return values;
		},

		async buildISBNDuplicateDiagnostic(pdfPath, identifier, identifierKeys, existingItems) {
			let lines = [
				"ZotLink ISBN 查重诊断",
				`PDF：${pdfPath}`,
				`PDF metadata ISBN：${identifier.value}`,
				`PDF ISBN keys：${identifierKeys.join(" | ") || "(none)"}`,
				`当前库 ISBN key 数：${existingItems?.size || 0}`,
				"",
				"当前库前 120 条 ISBN 字段："
			];
			try {
				let rows = await Zotero.DB.queryAsync(
					"SELECT I.itemID AS itemID, IDV.value AS fieldValue FROM items I JOIN itemData ID ON I.itemID=ID.itemID JOIN fields F ON ID.fieldID=F.fieldID JOIN itemDataValues IDV ON ID.valueID=IDV.valueID LEFT JOIN deletedItems DI ON I.itemID=DI.itemID WHERE I.libraryID=? AND DI.itemID IS NULL AND F.fieldName='ISBN' ORDER BY I.itemID LIMIT 120",
					[Zotero.Libraries.userLibraryID]
				);
				for (let row of rows) {
					let itemID = Number(row.itemID || row[0]);
					let value = row.fieldValue || row.value || row[1] || "";
					let keys = this.normalizeISBNValues(value);
					lines.push(`itemID=${itemID}；raw=${String(value).replace(/\r?\n/g, " / ")}；keys=${keys.join(" | ") || "(none)"}`);
				}
			}
			catch (e) {
				lines.push(`读取当前库 ISBN 字段失败：${this.errorToText(e) || e}`);
			}
			return lines.join("\n");
		},

		async addExistingItemToCollection(itemID, collectionID) {
			if (!itemID || !collectionID) {
				return false;
			}
			itemID = Number(itemID);
			collectionID = Number(collectionID);
			let alreadyInCollection = await this.itemIsInCollection(itemID, collectionID);
			let item = await Zotero.Items.getAsync(Number(itemID));
			if (!item?.isRegularItem?.()) {
				return false;
			}

			let collection = Zotero.Collections.get(collectionID);
			if (alreadyInCollection && collection && typeof collection.addItem === "function") {
				await Zotero.DB.queryAsync(
					"DELETE FROM collectionItems WHERE collectionID=? AND itemID=?",
					[collectionID, itemID]
				);
				alreadyInCollection = false;
			}
			if (collection && typeof collection.addItem === "function") {
				collection.addItem(itemID);
				await collection.saveTx();
			}
			else {
				let collections = new Set((item.getCollections?.() || []).map(Number));
				collections.add(collectionID);
				if (typeof item.addToCollection === "function") {
					item.addToCollection(collectionID);
				}
				else if (typeof item.setCollections === "function") {
					item.setCollections(Array.from(collections));
				}
				else {
					await Zotero.DB.queryAsync(
						"INSERT OR IGNORE INTO collectionItems (collectionID, itemID) VALUES (?, ?)",
						[collectionID, item.id]
					);
				}
				if (typeof item.saveTx === "function") {
					await item.saveTx();
				}
			}

			if (!(await this.itemIsInCollection(itemID, collectionID))) {
				await Zotero.DB.queryAsync(
					"INSERT OR IGNORE INTO collectionItems (collectionID, itemID) VALUES (?, ?)",
					[collectionID, itemID]
				);
			}
			await this.cleanupDeletedSiblingCollectionMemberships(itemID, collectionID);
			return !alreadyInCollection;
		},

		async cleanupDeletedSiblingCollectionMemberships(itemID, collectionID) {
			itemID = Number(itemID) || 0;
			collectionID = Number(collectionID) || 0;
			if (!itemID || !collectionID) {
				return 0;
			}
			try {
				let rows = await Zotero.DB.queryAsync(
					"SELECT collectionName, parentCollectionID FROM collections WHERE collectionID=?",
					[collectionID]
				);
				let row = rows?.[0];
				let collectionName = row?.collectionName || row?.collectionname || row?.[0] || "";
				let parentID = row?.parentCollectionID || row?.parentcollectionid || row?.[1] || null;
				if (!collectionName) {
					return 0;
				}
				let params;
				let sql;
				if (parentID) {
					sql = "SELECT C.collectionID AS collectionID FROM collections C JOIN deletedCollections DC ON C.collectionID=DC.collectionID WHERE C.collectionID<>? AND C.collectionName=? AND C.parentCollectionID=?";
					params = [collectionID, collectionName, Number(parentID)];
				}
				else {
					sql = "SELECT C.collectionID AS collectionID FROM collections C JOIN deletedCollections DC ON C.collectionID=DC.collectionID WHERE C.collectionID<>? AND C.collectionName=? AND C.parentCollectionID IS NULL";
					params = [collectionID, collectionName];
				}
				let deletedRows = await Zotero.DB.queryAsync(sql, params);
				let deletedIDs = (deletedRows || [])
					.map(row => Number(row.collectionID || row.collectionid || row[0]))
					.filter(Boolean);
				let removed = 0;
				for (let deletedID of deletedIDs) {
					await Zotero.DB.queryAsync(
						"DELETE FROM collectionItems WHERE collectionID=? AND itemID=?",
						[deletedID, itemID]
					);
					removed++;
				}
				return removed;
			}
			catch (e) {
				Zotero.logError(e);
				return 0;
			}
		},

		async itemIsInCollection(itemID, collectionID) {
			itemID = Number(itemID) || 0;
			collectionID = Number(collectionID) || 0;
			if (!itemID || !collectionID) {
				return false;
			}
			try {
				let rows = await Zotero.DB.queryAsync(
					"SELECT itemID FROM collectionItems WHERE collectionID=? AND itemID=? LIMIT 1",
					[collectionID, itemID]
				);
				return Boolean(rows?.length);
			}
			catch (e) {
				Zotero.logError(e);
				return false;
			}
		},

		async attachOrMirrorPDFForExistingItem({ itemID, pdfPath, collectionID, index }) {
			let addedToCollection = await this.addExistingItemToCollection(itemID, collectionID);
			let item = await Zotero.Items.getAsync(Number(itemID));
			if (!item?.isRegularItem?.()) {
				return { addedToCollection, attachmentCreated: false, mirrorSynced: false };
			}
			let attachment = await this.getPrimaryPDFAttachmentForItem(item);
			if (!attachment) {
				attachment = await this.createLinkedPDFAttachmentForItem(item, pdfPath, index, { firstImport: false });
				return { addedToCollection, attachmentCreated: true, mirrorSynced: false };
			}
			let result = await this.syncAttachmentMirrors(attachment, {
				index,
				save: false,
				preferredCollectionID: collectionID
			});
			return { addedToCollection, attachmentCreated: false, mirrorSynced: Boolean(result?.changed || result?.shortcutPathCount) };
		},

		getIdentifierFieldName(type) {
			if (type === "doi") {
				return "DOI";
			}
			if (type === "isbn") {
				return "ISBN";
			}
			return "";
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

		normalizeISBN(isbn) {
			return this.normalizeISBNValues(isbn)[0] || "";
		},

		normalizeISBNValues(isbnText) {
			let text = String(isbnText || "").toUpperCase();
			let candidates = [];
			let addCandidate = candidate => {
				if (candidate) {
					candidates.push(candidate);
				}
			};
			for (let pattern of [
				/ISBN(?:-1[03])?:?\s*((?:97[89][\s-]*(?:\d[\s-]*){9}\d)|(?:\d[\s-]*){9}[0-9X])/gi,
				/(?:^|[^0-9X])((?:97[89][\s-]*(?:\d[\s-]*){9}\d)|(?:\d[\s-]*){9}[0-9X])(?:$|[^0-9X])/gi
			]) {
				for (let match of text.matchAll(pattern)) {
					addCandidate(match[1]);
				}
			}
			for (let part of text.split(/[\r\n;,，；]+/)) {
				let normalizedPart = String(part || "").replace(/^ISBN(?:-1[03])?:?\s*/i, "");
				let compact = normalizedPart.replace(/[^0-9X]/gi, "").toUpperCase();
				if (compact.length === 10 || compact.length === 13) {
					addCandidate(compact);
					continue;
				}
				let isbn13Matches = normalizedPart.match(/97[89][\s-]*(?:\d[\s-]*){9}\d/gi) || [];
				for (let match of isbn13Matches) {
					addCandidate(match);
				}
				let withoutISBN13 = normalizedPart.replace(/97[89][\s-]*(?:\d[\s-]*){9}\d/gi, " ");
				for (let match of withoutISBN13.matchAll(/(?:^|[^0-9X])((?:\d[\s-]*){9}[0-9X])(?:$|[^0-9X])/gi)) {
					addCandidate(match[1]);
				}
			}
			let values = [];
			let seen = new Set();
			for (let candidate of candidates) {
				let value = String(candidate || "")
				.toUpperCase()
				.replace(/^ISBN(?:-1[03])?:?\s*/i, "")
				.replace(/[^0-9X]/g, "");
				if (!this.isValidISBN(value) || seen.has(value)) {
					continue;
				}
				seen.add(value);
				values.push(value);
				for (let equivalent of this.getEquivalentISBNValues(value)) {
					if (!seen.has(equivalent)) {
						seen.add(equivalent);
						values.push(equivalent);
					}
				}
			}
			return values;
		},

		getEquivalentISBNValues(value) {
			value = String(value || "").toUpperCase().replace(/[^0-9X]/g, "");
			let equivalents = [];
			if (value.length === 10 && this.isValidISBN(value)) {
				let base = `978${value.slice(0, 9)}`;
				equivalents.push(base + this.computeISBN13CheckDigit(base));
			}
			else if (value.length === 13 && value.startsWith("978") && this.isValidISBN(value)) {
				let base = value.slice(3, 12);
				equivalents.push(base + this.computeISBN10CheckDigit(base));
			}
			return equivalents.filter(candidate => this.isValidISBN(candidate));
		},

		computeISBN13CheckDigit(first12) {
			let total = 0;
			for (let i = 0; i < 12; i++) {
				total += (i % 2 === 0 ? 1 : 3) * Number(first12[i]);
			}
			return String((10 - (total % 10)) % 10);
		},

		computeISBN10CheckDigit(first9) {
			let total = 0;
			for (let i = 0; i < 9; i++) {
				total += (10 - i) * Number(first9[i]);
			}
			let value = (11 - (total % 11)) % 11;
			return value === 10 ? "X" : String(value);
		},

		isValidISBN(value) {
			value = String(value || "").toUpperCase().replace(/[^0-9X]/g, "");
			if (value.length === 13 && /^(978|979)\d{10}$/.test(value)) {
				let total = 0;
				for (let i = 0; i < value.length; i++) {
					total += (i % 2 === 0 ? 1 : 3) * Number(value[i]);
				}
				return total % 10 === 0;
			}
			if (value.length === 10 && /^\d{9}[0-9X]$/.test(value)) {
				let total = 0;
				for (let i = 0; i < value.length; i++) {
					let digit = value[i] === "X" ? 10 : Number(value[i]);
					total += (10 - i) * digit;
				}
				return total % 11 === 0;
			}
			return false;
		},

		normalizeIdentifierValue(identifier) {
			return this.normalizeIdentifierValues(identifier)[0] || "";
		},

		normalizeIdentifierValues(identifier) {
			if (identifier?.type === "doi") {
				let doi = this.normalizeDOI(identifier.value);
				return doi ? [doi] : [];
			}
			if (identifier?.type === "isbn") {
				return this.normalizeISBNValues(identifier.value);
			}
			return [];
		},

		async createLinkedPDFItemFromDOI({ doi, pdfPath, collectionID, index }) {
			return this.createLinkedPDFItemFromIdentifier({
				identifier: { type: "doi", value: doi },
				pdfPath,
				collectionID,
				index
			});
		},

		async createLinkedPDFItemFromIdentifier({ identifier, pdfPath, collectionID, index }) {
			let item = await this.createRegularItemFromIdentifier({
				identifier,
				pdfPath,
				collectionID
			});
			let itemID = Number(item?.id) || 0;
			if (!itemID) {
				throw new Error("文献条目已创建但无法取得 itemID");
			}

			await this.createLinkedPDFAttachmentForItem(item, pdfPath, index, { firstImport: true });
			return item;
		},

		async createLinkedPDFAttachmentForItem(item, pdfPath, index, options = {}) {
			let itemID = Number(item?.id) || 0;
			if (!itemID) {
				throw new Error("无法为无效条目创建链接附件");
			}
			let attachment = new Zotero.Item("attachment");
			attachment.libraryID = Zotero.Libraries.userLibraryID;
			attachment.parentID = itemID;
			attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
			attachment.attachmentPath = pdfPath;
			attachment.attachmentContentType = "application/pdf";
			attachment.setField("title", PathUtils.filename(pdfPath));
			await attachment.saveTx();
			if (!attachment.id) {
				throw new Error(`链接附件保存后没有 attachmentID：${pdfPath}`);
			}
			await this.runAutomaticPDFOperations(attachment, { firstImport: Boolean(options.firstImport) });
			await this.indexAttachmentFileID(attachment, {
				quiet: true,
				index,
				save: false
			});
			return attachment;
		},

		async createRegularItemFromDOI({ doi, pdfPath, collectionID }) {
			return this.createRegularItemFromIdentifier({
				identifier: { type: "doi", value: doi },
				pdfPath,
				collectionID
			});
		},

		async createRegularItemFromIdentifier({ identifier, pdfPath, collectionID }) {
			let metadata = await this.lookupMetadataByIdentifier(identifier);
			let item = this.createItemFromTranslatedMetadata(metadata, identifier, pdfPath);
			item.libraryID = Zotero.Libraries.userLibraryID;
			if (typeof item.setCollections === "function") {
				item.setCollections(collectionID ? [collectionID] : []);
			}
			let itemID = await item.saveTx();
			if (metadata) {
				this._citationMetadataByItemID.set(Number(itemID), metadata);
			}
			if (collectionID && typeof item.setCollections !== "function") {
				await Zotero.DB.queryAsync(
					"INSERT OR IGNORE INTO collectionItems (collectionID, itemID) VALUES (?, ?)",
					[collectionID, itemID]
				);
			}
			let savedItem = await Zotero.Items.getAsync(Number(itemID));
			return savedItem || item;
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
					let result = await this.renameAttachmentByCitation(attachment, { silent: true });
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

		async renameAttachmentByCitation(attachment, options = {}) {
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

			let doi = this.normalizeDOI(parent.getField?.("DOI"));
			if (!doi) {
				return { ok: false, changed: false, reason: "父条目没有 DOI" };
			}
			let metadata = options.metadata
				|| this._citationMetadataByItemID.get(Number(parent.id))
				|| await this.lookupMetadataByDOI(doi);
			if (!metadata) {
				return { ok: false, changed: false, reason: "无法通过 DOI 获取引用信息" };
			}

			let filenameResult = this.buildCitationFilename(parent, metadata, sourcePath);
			if (!filenameResult.filename) {
				return { ok: false, changed: false, reason: filenameResult.reason || "无法生成文件名" };
			}
			let destinationPath = PathUtils.join(this.getParentPath(sourcePath), filenameResult.filename);
			if (this.pathsEqual(sourcePath, destinationPath)) {
				return { ok: true, changed: false, reason: "文件名已符合规则" };
			}
			if (await IOUtils.exists(destinationPath)) {
				return { ok: false, changed: false, reason: "目标文件名已存在" };
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

		buildCitationFilename(item, metadata, sourcePath) {
			let creators = Array.isArray(metadata?.creators) ? metadata.creators : [];
			if (!creators.length) {
				try {
					creators = item.getCreators?.() || [];
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
			let authors = creators.filter(creator => !creator.creatorType || creator.creatorType === "author");
			let editors = creators.filter(creator => creator.creatorType === "editor");
			let people = authors.length ? authors : editors;
			let authorLabel = this.getCitationPeopleLabel(people);
			if (!authorLabel) {
				return { filename: "", reason: "引用信息没有作者或编者" };
			}
			if (!authors.length && editors.length) {
				authorLabel += editors.length === 1 ? " (ed.)" : " (eds.)";
			}

			let yearText = [metadata?.date, metadata?.year, item.getField?.("date")]
				.map(value => String(value || ""))
				.find(value => /\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/.test(value)) || "";
			let year = (yearText.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/) || [])[1] || "n.d.";
			let title = this.stripCitationMarkup(this.firstCitationText(metadata?.title) || item.getField?.("title") || "Untitled").replace(/\?+$/g, "");
			let subtitle = this.stripCitationMarkup(this.firstCitationText(metadata?.subtitle) || "").replace(/\?+$/g, "");
			let mainTitle = title;
			if (!subtitle && title.includes(":")) {
				let parts = title.split(":");
				mainTitle = parts.shift()?.trim() || title;
				subtitle = parts.join(":").trim();
			}
			mainTitle = this.cleanCitationFilenamePiece(mainTitle) || "Untitled";
			subtitle = this.cleanCitationFilenamePiece(subtitle);

			let extension = Zotero.File.getExtension(sourcePath) || "pdf";
			let parentPath = this.getParentPath(sourcePath);
			let mainStem = `${authorLabel} ${year} ${mainTitle}`.trim();
			let fullStem = subtitle ? `${mainStem}  ${subtitle}` : mainStem;
			let fullFilename = `${fullStem}.${extension}`;
			if (PathUtils.join(parentPath, fullFilename).length <= MAX_CITATION_PATH_LENGTH) {
				return { filename: fullFilename, omittedSubtitle: false };
			}
			let mainFilename = `${mainStem}.${extension}`;
			if (PathUtils.join(parentPath, mainFilename).length <= MAX_CITATION_PATH_LENGTH) {
				return { filename: mainFilename, omittedSubtitle: Boolean(subtitle) };
			}
			return { filename: "", reason: `仅保留主标题后路径仍超过 ${MAX_CITATION_PATH_LENGTH} 字符` };
		},

		getCitationPeopleLabel(people) {
			let names = (people || [])
				.map(person => this.cleanCitationFilenamePiece(person?.lastName || person?.family || person?.name || ""))
				.filter(Boolean);
			if (!names.length) {
				return "";
			}
			if (names.length === 1) {
				return names[0];
			}
			if (names.length === 2) {
				return `${names[0]} & ${names[1]}`;
			}
			return `${names[0]} et al.`;
		},

		firstCitationText(value) {
			return Array.isArray(value) ? String(value[0] || "") : String(value || "");
		},

		stripCitationMarkup(value) {
			return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\s+®/g, "®").trim();
		},

		cleanCitationFilenamePiece(value) {
			return String(value || "")
				.normalize("NFKC")
				.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
				.replace(/\s+/g, " ")
				.replace(/[. ]+$/g, "")
				.trim();
		},

		sanitizeFilename(name) {
			return String(name || "")
				.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
				.replace(/\s+/g, " ")
				.replace(/[. ]+$/g, "")
				.trim();
		},

		async runAutomaticPDFOperations(attachment, options = {}) {
			if (!attachment?.isFileAttachment?.()) {
				return;
			}
			let path = attachment.getFilePath?.();
			if (!this.isPDFFilePath(path, attachment)) {
				return;
			}

			try {
				let isPrimaryPDF = await this.isPrimaryPDFAttachment(attachment);
				if (isPrimaryPDF && this.getBoolPref("autoWritePDFDOIMetadata", true)) {
					await this.writeAttachmentPDFDOIMetadata(attachment, { silent: true });
				}

				if (options.firstImport
					&& isPrimaryPDF
					&& this.getBoolPref("autoRenameNewAttachments", false)
					&& !this._automaticCitationRenameHandledAttachmentIDs.has(Number(attachment.id))) {
					let renameResult = await this.renameAttachmentByCitation(attachment, {
						silent: true,
						metadata: this._citationMetadataByItemID.get(Number(attachment.parentItem?.id))
					});
					if (renameResult.ok) {
						this._automaticCitationRenameHandledAttachmentIDs.add(Number(attachment.id));
						path = attachment.getFilePath?.() || renameResult.path || path;
					}
				}
				if (isPrimaryPDF && this.getBoolPref("autoAlignPDFPageLabels", true)) {
					await this.alignAttachmentPDFPageLabels(attachment, { silent: true });
				}
				if (isPrimaryPDF && this.getBoolPref("autoExtractArticleHistory", false)) {
					await this.writeAttachmentArticleHistory(attachment, { silent: true });
				}

				let openToFirstPage = this.getBoolPref("autoSetPDFOpenToFirstPage", true);
				let displayTitleFileName = this.getBoolPref("autoSetPDFDisplayTitleFileName", true);
				if (openToFirstPage || displayTitleFileName) {
					await this.writePDFViewerPreferencesWithPikepdf(path, {
						openToFirstPage,
						displayTitleFileName
					});
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
			finally {
				this._citationMetadataByItemID.delete(Number(attachment.parentItem?.id));
			}
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

		async alignSelectedPDFPageLabels() {
			let attachments = await this.getSelectedPrimaryPDFAttachments();
			if (!attachments.length) {
				this.showMoveReport("未找到可对齐页码的主 PDF 附件");
				return;
			}

			let aligned = 0;
			let skipped = 0;
			let reasons = new Map();
			for (let attachment of attachments) {
				try {
					let result = await this.alignAttachmentPDFPageLabels(attachment, { silent: true });
					if (result.ok && result.changed) {
						aligned++;
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
			this.showMoveReport(`选中主 PDF 页码对齐完成：共检查 ${attachments.length} 个主 PDF，已对齐 ${aligned} 个${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。`);
		},

		async writeSelectedArticleHistory() {
			let attachments = await this.getSelectedPrimaryPDFAttachments();
			if (!attachments.length) {
				this.showMoveReport("未找到可提取文章历史时间线的主 PDF 附件");
				return;
			}

			let written = 0;
			let skipped = 0;
			let reasons = new Map();
			for (let attachment of attachments) {
				try {
					let result = await this.writeAttachmentArticleHistory(attachment, { silent: true });
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
			this.showMoveReport(`选中主 PDF 文章历史时间线提取完成：共检查 ${attachments.length} 个主 PDF，已写入 ${written} 个${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。`);
		},

		async writeAttachmentArticleHistory(attachment, options = {}) {
			if (!attachment?.isFileAttachment?.()) {
				return { ok: false, changed: false, reason: "不是文件附件" };
			}
			if (attachment.libraryID !== Zotero.Libraries.userLibraryID) {
				return { ok: false, changed: false, reason: "非个人库附件" };
			}
			if (!(await this.isPrimaryPDFAttachment(attachment))) {
				return { ok: false, changed: false, reason: "不是主 PDF" };
			}
			let parent = attachment.parentItem;
			if (!parent?.isRegularItem?.()) {
				return { ok: false, changed: false, reason: "没有父条目" };
			}
			if (!this.isJournalArticleItem(parent)) {
				return { ok: false, changed: false, reason: "父条目不是期刊文章" };
			}
			let path = attachment.getFilePath();
			if (!path || !(await IOUtils.exists(path))) {
				return { ok: false, changed: false, reason: "源文件不存在" };
			}
			if (!this.isPDFFilePath(path, attachment)) {
				return { ok: false, changed: false, reason: "不是 PDF" };
			}

			let result = await this.extractArticleHistoryFromPDF(path);
			if (!result.ok) {
				return result;
			}
			let update = await this.writeArticleHistoryToExtra(parent, result.history || {});
			if (update.changed && !options.silent) {
				this.showSoftReport(`已写入文章历史时间线：${this.getItemDisplayName(parent)}`, 3000);
			}
			return {
				ok: true,
				changed: update.changed,
				reason: update.changed ? "已写入文章历史时间线" : "Extra 已是最新",
				history: result.history
			};
		},

		isJournalArticleItem(item) {
			if (!item?.isRegularItem?.()) {
				return false;
			}
			try {
				let typeName = Zotero.ItemTypes.getName(item.itemTypeID);
				return typeName === "journalArticle";
			}
			catch (e) {
				return String(item.itemType || "").toLowerCase() === "journalarticle";
			}
		},

		async writeArticleHistoryToExtra(item, history) {
			let fields = [
				["received", "Received"],
				["revised", "Revised"],
				["accepted", "Accepted"],
				["online", "Online"]
			];
			let values = new Map();
			for (let [key, label] of fields) {
				let value = String(history?.[key] || "").trim();
				if (value) {
					values.set(label, value);
				}
			}
			let extra = String(item.getField?.("extra") || "");
			let existingValues = this.parseExtraKeyValueLines(extra);
			for (let [, label] of fields) {
				let existing = this.getExtraValueByNormalizedKeys(existingValues, [
					label,
					`${label} Date`
				]);
				if (existing) {
					values.delete(label);
				}
			}
			if (!values.size) {
				return { changed: false };
			}

			let lines = extra ? extra.split(/\r?\n/) : [];
			let seen = new Set();
			lines = lines.map(line => {
				let match = line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/);
				if (!match) {
					return line;
				}
				let normalizedKey = this.normalizeExtraKey(match[1]);
				let canonical = fields.find(([, label]) => [
					this.normalizeExtraKey(label),
					this.normalizeExtraKey(`${label} Date`)
				].includes(normalizedKey))?.[1];
				if (!canonical || String(match[2] || "").trim()) {
					return line;
				}
				if (!values.has(canonical)) {
					return line;
				}
				seen.add(canonical);
				return `${canonical}: ${values.get(canonical)}`;
			});
			for (let [, label] of fields) {
				if (values.has(label) && !seen.has(label)) {
					lines.push(`${label}: ${values.get(label)}`);
				}
			}
			let nextExtra = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
			if (nextExtra === extra.trim()) {
				return { changed: false };
			}
			item.setField("extra", nextExtra);
			await item.saveTx();
			this.refreshArticleHistoryInfoRows();
			return { changed: true };
		},

		getArticleHistoryDateValue(item, key) {
			if (!this.isJournalArticleItem(item)) {
				return "";
			}
			let values = this.parseExtraKeyValueLines(item.getField?.("extra") || "");
			return this.getExtraValueByNormalizedKeys(values, [
				key,
				`${key} Date`
			]);
		},

		async setArticleHistoryDateValue(item, key, value) {
			let extra = item.getField?.("extra") || "";
			item.setField("extra", this.updateExtraKeyValue(extra, key, value));
			await item.saveTx();
			this.refreshArticleHistoryInfoRows();
		},

		hasAnyArticleHistoryDateValue(item) {
			if (!item?.isRegularItem?.()) {
				return false;
			}
			let values = this.parseExtraKeyValueLines(item.getField?.("extra") || "");
			return ARTICLE_HISTORY_INFO_ROWS.some(definition => this.getExtraValueByNormalizedKeys(values, [
				definition.key,
				`${definition.key} Date`
			]));
		},

		hasAllArticleHistoryDateValues(item) {
			if (!item?.isRegularItem?.()) {
				return false;
			}
			let values = this.parseExtraKeyValueLines(item.getField?.("extra") || "");
			return ARTICLE_HISTORY_INFO_ROWS.every(definition => this.getExtraValueByNormalizedKeys(values, [
				definition.key,
				`${definition.key} Date`
			]));
		},

		parseExtraKeyValueLines(extra) {
			let values = new Map();
			for (let line of String(extra || "").split(/\r?\n/)) {
				let match = line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/);
				if (match) {
					values.set(match[1].trim(), match[2].trim());
				}
			}
			return values;
		},

		updateExtraKeyValue(extra, key, value) {
			let lines = String(extra || "").split(/\r?\n/);
			let normalizedTarget = this.normalizeExtraKey(key);
			let updated = false;
			let nextLines = [];
			for (let line of lines) {
				let match = line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/);
				if (!match || this.normalizeExtraKey(match[1]) !== normalizedTarget) {
					nextLines.push(line);
					continue;
				}
				updated = true;
				if (String(value || "").trim()) {
					nextLines.push(`${key}: ${String(value).trim()}`);
				}
			}
			if (!updated && String(value || "").trim()) {
				nextLines.push(`${key}: ${String(value).trim()}`);
			}
			return nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
		},

		getExtraValueByNormalizedKeys(values, targetKeys) {
			for (let targetKey of targetKeys) {
				let value = this.getExtraValueByNormalizedKey(values, targetKey);
				if (value) {
					return value;
				}
			}
			return "";
		},

		getExtraValueByNormalizedKey(values, targetKey) {
			let normalizedTarget = this.normalizeExtraKey(targetKey);
			for (let [key, value] of values.entries()) {
				if (this.normalizeExtraKey(key) === normalizedTarget) {
					return value;
				}
			}
			return "";
		},

		normalizeExtraKey(key) {
			return String(key || "")
				.trim()
				.toLowerCase()
				.replace(/[\s_]+/g, "-")
				.replace(/-+/g, "-");
		},

		isISODateValue(value) {
			return !String(value || "").trim() || /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
		},

		async extractArticleHistoryFromPDF(pdfPath) {
			let outputPath = this.getTempTextPath("zotlink-article-history");
			let scriptPath = this.getTempTextPath("zotlink-article-history").replace(/\.txt$/i, ".py");
			let script = [
				"import calendar, json, re, sys, traceback",
				"path, output = sys.argv[1], sys.argv[2]",
				"MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}",
				"MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})",
				"DATE_PAT = r'(?:\\d{1,2}\\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s*,?\\s*\\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2},?\\s+\\d{4}|\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4})'",
				"LABELS = {",
				"    'received': [r'Received'],",
				"    'revised': [r'Received\\s+in\\s+revised\\s+form', r'Revision\\s+received', r'Revised'],",
				"    'accepted': [r'Accepted\\s+in\\s+final\\s+revised\\s+form', r'Accepted\\s+in\\s+final\\s+form', r'Accepted\\s+for\\s+publication', r'Accepted'],",
				"    'online': [r'First\\s+published\\s+online', r'Published\\s+online', r'Available\\s+online', r'Online\\s+publication', r'Online']",
				"}",
				"def finish(**data):",
				"    with open(output, 'w', encoding='utf-8') as f:",
				"        json.dump(data, f, ensure_ascii=False)",
				"def clean_text(text):",
				"    text = (text or '').replace('\\u200b', '').replace('\\ufeff', '')",
				"    text = re.sub(r'[ \\t\\r\\f\\v]+', ' ', text)",
				"    text = re.sub(r'\\n+', '\\n', text)",
				"    return text",
				"def parse_date(raw):",
				"    value = re.sub(r'\\s+', ' ', (raw or '').strip().strip('.,;:()[]'))",
				"    m = re.match(r'^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})$', value)",
				"    if m:",
				"        y, mo, d = map(int, m.groups())",
				"        return f'{y:04d}-{mo:02d}-{d:02d}'",
				"    m = re.match(r'^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{2,4})$', value)",
				"    if m:",
				"        a, b, y = map(int, m.groups())",
				"        y = y + 2000 if y < 100 else y",
				"        if a > 12:",
				"            d, mo = a, b",
				"        elif b > 12:",
				"            mo, d = a, b",
				"        else:",
				"            d, mo = a, b",
				"        return f'{y:04d}-{mo:02d}-{d:02d}'",
				"    m = re.match(r'^(\\d{1,2})\\s+([A-Za-z.]+),?\\s+(\\d{4})$', value)",
				"    if m:",
				"        d, mon, y = m.groups()",
				"        mo = MONTHS.get(mon.rstrip('.').lower())",
				"        return f'{int(y):04d}-{mo:02d}-{int(d):02d}' if mo else ''",
				"    m = re.match(r'^([A-Za-z.]+)\\s+(\\d{1,2}),?\\s+(\\d{4})$', value)",
				"    if m:",
				"        mon, d, y = m.groups()",
				"        mo = MONTHS.get(mon.rstrip('.').lower())",
				"        return f'{int(y):04d}-{mo:02d}-{int(d):02d}' if mo else ''",
				"    return ''",
				"def find_field(text, labels):",
				"    for label in labels:",
				"        pat = re.compile(label + r'\\s*(?:[:：,;\\-–—]|\\s)\\s*(?:on\\s+)?(' + DATE_PAT + r')', re.I)",
				"        m = pat.search(text)",
				"        if m:",
				"            parsed = parse_date(m.group(1))",
				"            if parsed:",
				"                return parsed",
				"    return ''",
				"try:",
				"    import fitz",
				"except Exception as e:",
				"    finish(ok=False, changed=False, reason='缺少 PyMuPDF/fitz', detail=str(e))",
				"    sys.exit(0)",
				"try:",
				"    doc = fitz.open(path)",
				"    total = len(doc)",
				"    pages = []",
				"    edge_pages = list(range(0, min(total, 4))) + list(range(max(0, total - 4), total))",
				"    for i in edge_pages:",
				"        if i not in pages:",
				"            pages.append(i)",
				"    history = {'received': '', 'revised': '', 'accepted': '', 'online': ''}",
				"    pages_checked = 0",
				"    for page_idx in pages:",
				"        text = clean_text(doc[page_idx].get_text('text'))",
				"        pages_checked += 1",
				"        for key, labels in LABELS.items():",
				"            if not history[key]:",
				"                history[key] = find_field(text, labels)",
				"        if all(history.values()):",
				"            break",
				"    doc.close()",
				"    history = {k: v for k, v in history.items() if v}",
				"    if history:",
				"        finish(ok=True, changed=True, history=history, pagesChecked=pages_checked)",
				"    else:",
				"        finish(ok=False, changed=False, reason='未发现文章历史时间线', pagesChecked=pages_checked)",
				"except Exception as e:",
				"    finish(ok=False, changed=False, reason='文章历史时间线提取失败', detail=''.join(traceback.format_exception_only(type(e), e)).strip())"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(script));
				let execResult = await this.execDiagnosticCommand("C:\\Windows\\pyw.exe", [
					"-3",
					scriptPath,
					pdfPath,
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
						reason: "文章历史时间线提取结果无法解析",
						detail: text || execResult.diagnostic
					};
				}
				if (!result.ok) {
					Zotero.debug(`ZotLink article history extraction skipped/failed: ${result.reason || ""} ${result.detail || ""}`, 1);
				}
				return result;
			}
			catch (e) {
				Zotero.logError(e);
				return {
					ok: false,
					changed: false,
					reason: "文章历史时间线提取失败",
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

		async writeAllLibraryArticleHistory(options = {}) {
			let attachments = await this.getAllUserFileAttachments();
			attachments = attachments.filter(attachment => this.isPDFFilePath(attachment.getFilePath?.(), attachment));
			if (!attachments.length) {
				if (options.silent) {
					return { total: 0, written: 0, skipped: 0, skippedExisting: 0 };
				}
				if (options.softReport) {
					this.showSoftReport("个人库中未找到 PDF 文件附件。", 5000);
				}
				else {
					this.showPreferenceAlert("文章历史时间线提取结果", "个人库中未找到 PDF 文件附件。");
				}
				return { total: 0, written: 0, skipped: 0, skippedExisting: 0 };
			}

			let useProgressWindow = options.useProgressWindow !== false;
			let progressWindow = useProgressWindow
				? this.createProgressWindow("正在提取文章历史时间线", `已处理 0 / ${attachments.length}`)
				: null;
			let written = 0;
			let skipped = 0;
			let skippedExisting = 0;
			let reasons = new Map();
			let startedAt = Date.now();

			for (let i = 0; i < attachments.length; i++) {
				let attachment = attachments[i];
				try {
					let path = attachment.getFilePath?.() || "";
					if (options.requireManagedPath
						&& (!path || !(await IOUtils.exists(path)) || !this.isPathInsideRoot(path, this.getAttachmentMoveRoot()))) {
						skipped++;
						this.countReason(reasons, "附件路径失效或位于顶层路径外");
						continue;
					}
					let parent = attachment.parentItem;
					if (parent && this.hasAllArticleHistoryDateValues(parent)) {
						skipped++;
						skippedExisting++;
						continue;
					}
					let result = await this.writeAttachmentArticleHistory(attachment, { silent: true });
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
						skipped,
						skippedExisting
					});
					this.updateProgressWindow(progressWindow, "正在提取文章历史时间线", `已处理 ${processed} / ${attachments.length}，写入 ${written}，已存在 ${skippedExisting}，跳过 ${skipped}`);
				}
			}

			let seconds = Math.round((Date.now() - startedAt) / 1000);
			let reasonText = this.formatReasons(reasons);
			let otherSkipped = skipped - skippedExisting;
			let message = `全库文章历史时间线提取完成：共检查 ${attachments.length} 个 PDF 附件，已写入 ${written} 个，已存在跳过 ${skippedExisting} 个${otherSkipped ? `，其他跳过 ${otherSkipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。耗时约 ${seconds} 秒。`;
			this.updateProgressWindow(progressWindow, "文章历史时间线提取完成", `写入 ${written}，已存在 ${skippedExisting}，跳过 ${skipped}，耗时约 ${seconds} 秒`, 6000);
			if (options.silent) {
				return { total: attachments.length, written, skipped, skippedExisting, message };
			}
			if (options.softReport) {
				this.showSoftReport(message, 8000);
			}
			else {
				this.showPreferenceAlert("文章历史时间线提取结果", message);
			}
			return { total: attachments.length, written, skipped, skippedExisting, message };
		},

		async alignAttachmentPDFPageLabels(attachment, options = {}) {
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

			let pageRange = this.getAttachmentParentPageRange(attachment);
			if (!pageRange) {
				return { ok: false, changed: false, reason: "父条目页码不是常规范围" };
			}

			let result = await this.writePDFPageLabelsWithPikepdf(path, pageRange, this.getAttachmentParentDOI(attachment));
			if (result.ok && result.changed && !options.silent) {
				this.showSoftReport(`已对齐 PDF 页码：${PathUtils.filename(path)}`, 3000);
			}
			return result;
		},

		getAttachmentParentDOI(attachment) {
			let parent = attachment?.parentItem;
			if (!parent?.isRegularItem?.()) {
				return "";
			}
			return this.normalizeDOI(parent.getField?.("DOI"));
		},

		getAttachmentParentPageRange(attachment) {
			let parent = attachment?.parentItem;
			if (!parent?.isRegularItem?.()) {
				return "";
			}
			return this.normalizePageRange(parent.getField?.("pages"));
		},

		normalizePageRange(value) {
			let text = String(value || "").trim();
			if (!text || !/[-–—]/.test(text)) {
				return "";
			}
			let match = text.match(/^\s*([A-Za-z]*)(\d+)\s*[-–—]\s*([A-Za-z]*)(\d+)\s*$/);
			return match ? text : "";
		},

		isPDFFilePath(path, attachment = null) {
			let contentType = String(attachment?.attachmentContentType || "").toLowerCase();
			return contentType === "application/pdf" || /\.pdf$/i.test(String(path || ""));
		},

		async writePDFPageLabelsWithPikepdf(pdfPath, pageRange, doi = "") {
			let outputPath = this.getTempTextPath("zotlink-pdf-page-labels");
			let scriptPath = this.getTempTextPath("zotlink-pdf-page-labels").replace(/\.txt$/i, ".py");
			let script = [
				"import json, os, re, shutil, sys, tempfile, traceback",
				"path, page_range, doi, output = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]",
				"PAGE_RANGE_RE = re.compile(r'^\\s*([A-Za-z]*)(\\d+)\\s*[-–—]\\s*([A-Za-z]*)(\\d+)\\s*$')",
				"def finish(**data):",
				"    with open(output, 'w', encoding='utf-8') as f:",
				"        json.dump(data, f, ensure_ascii=False)",
				"def parse_page_range(value):",
				"    match = PAGE_RANGE_RE.match(value or '')",
				"    if not match:",
				"        return None",
				"    first_prefix, first_text, last_prefix, last_text = match.groups()",
				"    first_number = int(first_text)",
				"    last_number = int(last_text)",
				"    if last_number < first_number:",
				"        base = 10 ** len(last_text)",
				"        last_number = (first_number // base) * base + last_number",
				"        if last_number < first_number:",
				"            last_number += base",
				"    count = last_number - first_number + 1",
				"    if count <= 0:",
				"        return None",
				"    return {'first': first_number, 'last': last_number, 'prefix': first_prefix or last_prefix, 'count': count}",
				"def simple_dict(start, prefix, st):",
				"    data = {'/S': '/D', '/P': prefix, '/St': st}",
				"    return [start, data]",
				"def normalize_page_labels(root):",
				"    labels = root.get('/PageLabels', None)",
				"    if not labels:",
				"        return []",
				"    nums = labels.get('/Nums', [])",
				"    normalized = []",
				"    for i in range(0, len(nums), 2):",
				"        try:",
				"            start = int(nums[i])",
				"            label = nums[i + 1]",
				"        except Exception:",
				"            continue",
				"        item = {}",
				"        for key in ['/S', '/P', '/St']:",
				"            value = label.get(key, None)",
				"            if value is not None:",
				"                item[key] = str(value) if key != '/St' else int(value)",
				"        normalized.append([start, item])",
				"    return normalized",
				"try:",
				"    import pikepdf",
				"except Exception as e:",
				"    finish(ok=False, changed=False, reason='缺少 pikepdf', detail=str(e))",
				"    sys.exit(0)",
				"try:",
				"    article = parse_page_range(page_range)",
				"    if not article:",
				"        finish(ok=False, changed=False, reason='页码不是常规范围')",
				"        sys.exit(0)",
				"    with pikepdf.Pdf.open(path) as pdf:",
				"        page_count = len(pdf.pages)",
				"        if page_count < article['count']:",
				"            finish(ok=False, changed=False, reason='PDF 页数少于条目页码范围', pdfPages=page_count, articlePages=article['count'])",
				"            sys.exit(0)",
				"        front_extra = page_count - article['count']",
				"        planned = []",
				"        nums = pikepdf.Array()",
				"        if front_extra:",
				"            planned.append(simple_dict(0, 'skip-', 1))",
				"            nums.extend([0, pikepdf.Dictionary({'/S': pikepdf.Name('/D'), '/P': 'skip-', '/St': 1})])",
				"        planned.append(simple_dict(front_extra, article['prefix'], article['first']))",
				"        nums.extend([front_extra, pikepdf.Dictionary({'/S': pikepdf.Name('/D'), '/P': article['prefix'], '/St': article['first']})])",
				"        if normalize_page_labels(pdf.Root) == planned:",
				"            finish(ok=True, changed=False, reason='页码已对齐', pageRange=page_range, pdfPages=page_count)",
				"            sys.exit(0)",
				"        pdf.Root.PageLabels = pikepdf.Dictionary({'/Nums': nums})",
				"        fd, tmp_name = tempfile.mkstemp(prefix=os.path.splitext(os.path.basename(path))[0] + '.', suffix='.pdf', dir=os.path.dirname(path) or None)",
				"        os.close(fd)",
				"        try:",
				"            pdf.save(tmp_name)",
				"            shutil.move(tmp_name, path)",
				"        finally:",
				"            if os.path.exists(tmp_name):",
				"                os.unlink(tmp_name)",
				"    finish(ok=True, changed=True, reason='已对齐页码', pageRange=page_range, pdfPages=page_count, frontExtraPages=front_extra)",
				"except Exception as e:",
				"    finish(ok=False, changed=False, reason='页码写入失败', detail=''.join(traceback.format_exception_only(type(e), e)).strip())"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(script));
				let execResult = await this.execDiagnosticCommand("C:\\Windows\\pyw.exe", [
					"-3",
					scriptPath,
					pdfPath,
					pageRange,
					doi || "",
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
						reason: "无法解析页码写入结果",
						detail: text || execResult.diagnostic
					};
				}
				if (!result.ok) {
					Zotero.debug(`ZotLink PDF page-label write skipped/failed: ${result.reason || ""} ${result.detail || ""}`, 1);
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
				"        effective_doi = existing_doi or doi",
				"        desired_url = 'https://doi.org/' + effective_doi",
				"        def same_url(left, right):",
				"            return str(left or '').strip().rstrip('/').lower() == str(right or '').strip().rstrip('/').lower()",
				"        if existing_doi and existing_url and same_url(existing_url, desired_url):",
				"            finish(ok=True, changed=False, reason='已存在完整 DOI metadata', existingDOI=existing_doi, existingDOIURL=existing_url)",
				"            sys.exit(0)",
				"        if not existing_doi:",
				"            info['/doi'] = doi",
				"        if not same_url(existing_url, desired_url):",
				"            info['/doiURL'] = desired_url",
				"        fd, tmp_name = tempfile.mkstemp(prefix=os.path.splitext(os.path.basename(path))[0] + '.', suffix='.pdf', dir=os.path.dirname(path) or None)",
				"        os.close(fd)",
				"        try:",
				"            pdf.save(tmp_name)",
				"            shutil.move(tmp_name, path)",
				"        finally:",
				"            if os.path.exists(tmp_name):",
				"                os.unlink(tmp_name)",
				"    finish(ok=True, changed=True, reason='已补写 DOI metadata', wroteDOI=(not existing_doi), wroteDOIURL=(not same_url(existing_url, desired_url)), effectiveDOI=effective_doi)",
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

		async writePDFViewerPreferencesWithPikepdf(pdfPath, options = {}) {
			let outputPath = this.getTempTextPath("zotlink-pdf-viewer-prefs");
			let scriptPath = this.getTempTextPath("zotlink-pdf-viewer-prefs").replace(/\.txt$/i, ".py");
			let script = [
				"import json, os, shutil, sys, tempfile, traceback",
				"path, output, open_first, title_filename = sys.argv[1], sys.argv[2], sys.argv[3] == '1', sys.argv[4] == '1'",
				"def finish(**data):",
				"    with open(output, 'w', encoding='utf-8') as f:",
				"        json.dump(data, f, ensure_ascii=False)",
				"try:",
				"    import pikepdf",
				"except Exception as e:",
				"    finish(ok=False, changed=False, reason='缺少 pikepdf', detail=str(e))",
				"    sys.exit(0)",
				"try:",
				"    with pikepdf.Pdf.open(path) as pdf:",
				"        changed = False",
				"        if open_first and len(pdf.pages):",
				"            desired = pikepdf.Array([pdf.pages[0].obj, pikepdf.Name('/Fit')])",
				"            if str(pdf.Root.get('/OpenAction', '')) != str(desired):",
				"                pdf.Root.OpenAction = desired",
				"                changed = True",
				"        if title_filename:",
				"            viewer = pdf.Root.get('/ViewerPreferences', None)",
				"            if viewer is None:",
				"                viewer = pikepdf.Dictionary()",
				"                pdf.Root.ViewerPreferences = viewer",
				"                changed = True",
				"            if bool(viewer.get('/DisplayDocTitle', True)):",
				"                viewer.DisplayDocTitle = False",
				"                changed = True",
				"        if changed:",
				"            fd, tmp_name = tempfile.mkstemp(prefix=os.path.splitext(os.path.basename(path))[0] + '.', suffix='.pdf', dir=os.path.dirname(path) or None)",
				"            os.close(fd)",
				"            try:",
				"                pdf.save(tmp_name)",
				"                shutil.move(tmp_name, path)",
				"            finally:",
				"                if os.path.exists(tmp_name):",
				"                    os.unlink(tmp_name)",
				"        finish(ok=True, changed=changed, reason='已更新 PDF 查看偏好' if changed else 'PDF 查看偏好已是最新')",
				"except Exception as e:",
				"    finish(ok=False, changed=False, reason='PDF 查看偏好写入失败', detail=''.join(traceback.format_exception_only(type(e), e)).strip())"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(script));
				let execResult = await this.execDiagnosticCommand("C:\\Windows\\pyw.exe", [
					"-3",
					scriptPath,
					pdfPath,
					outputPath,
					options.openToFirstPage ? "1" : "0",
					options.displayTitleFileName ? "1" : "0"
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
						reason: "无法解析 PDF 查看偏好写入结果",
						detail: text || execResult.diagnostic
					};
				}
				if (!result.ok) {
					Zotero.debug(`ZotLink PDF viewer preferences skipped/failed: ${result.reason || ""} ${result.detail || ""}`, 1);
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
				if (options.silent) {
					return { total: 0, written: 0, pageLabelsAligned: 0, viewerPreferencesUpdated: 0, skipped: 0 };
				}
				if (options.softReport) {
					this.showSoftReport("个人库中未找到 PDF 文件附件。", 5000);
				}
				else {
					this.showPreferenceAlert("PDF DOI 元数据写入结果", "个人库中未找到 PDF 文件附件。");
				}
				return { total: 0, written: 0, pageLabelsAligned: 0, viewerPreferencesUpdated: 0, skipped: 0 };
			}

			let writeDOIMetadata = options.writeDOIMetadata !== false;
			let alignPageLabels = options.alignPageLabels !== false;
			let openToFirstPage = Boolean(options.openToFirstPage);
			let displayTitleFileName = Boolean(options.displayTitleFileName);
			let written = 0;
			let pageLabelsAligned = 0;
			let viewerPreferencesUpdated = 0;
			let skipped = 0;
			let reasons = new Map();
			let startedAt = Date.now();
			let useProgressWindow = options.useProgressWindow !== false;
			let progressWindow = useProgressWindow
				? this.createProgressWindow("正在写入 PDF DOI 元数据并对齐页码", `已处理 0 / ${attachments.length}`)
				: null;

			for (let i = 0; i < attachments.length; i++) {
				let attachment = attachments[i];
				try {
					let path = attachment.getFilePath?.() || "";
					if (options.requireManagedPath
						&& (!path || !(await IOUtils.exists(path)) || !this.isPathInsideRoot(path, this.getAttachmentMoveRoot()))) {
						skipped++;
						this.countReason(reasons, "附件路径失效或位于顶层路径外");
						continue;
					}
					let changedAnything = false;
					let isPrimaryPDF = (writeDOIMetadata || alignPageLabels)
						? await this.isPrimaryPDFAttachment(attachment)
						: false;
					if (writeDOIMetadata && isPrimaryPDF) {
						let result = await this.writeAttachmentPDFDOIMetadata(attachment, { silent: true });
						if (result.ok && result.changed) {
							written++;
							changedAnything = true;
						}
						else if (!result.ok) {
							this.countReason(reasons, `DOI：${result.reason || "未知原因"}`);
						}
					}

					if (alignPageLabels && isPrimaryPDF) {
						let pageResult = await this.alignAttachmentPDFPageLabels(attachment, { silent: true });
						if (pageResult.ok && pageResult.changed) {
							pageLabelsAligned++;
							changedAnything = true;
						}
						else if (!pageResult.ok) {
							this.countReason(reasons, `页码：${pageResult.reason || "未知原因"}`);
						}
					}

					if (openToFirstPage || displayTitleFileName) {
						let viewerResult = await this.writePDFViewerPreferencesWithPikepdf(attachment.getFilePath(), {
							openToFirstPage,
							displayTitleFileName
						});
						if (viewerResult.ok && viewerResult.changed) {
							viewerPreferencesUpdated++;
							changedAnything = true;
						}
						else if (!viewerResult.ok) {
							this.countReason(reasons, `查看设置：${viewerResult.reason || "未知原因"}`);
						}
					}

					if (changedAnything) {
						await this.indexAttachmentFileID(attachment, { quiet: true });
					}

					if (!changedAnything) {
						skipped++;
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
						pageLabelsAligned,
						viewerPreferencesUpdated,
						skipped
					});
					this.updateProgressWindow(progressWindow, "正在更新全库 PDF", `已处理 ${processed} / ${attachments.length}，DOI ${written}，页码 ${pageLabelsAligned}，查看设置 ${viewerPreferencesUpdated}`);
				}
			}

			let seconds = Math.round((Date.now() - startedAt) / 1000);
			let reasonText = this.formatReasons(reasons);
			let message = `全库 PDF 更新完成：共检查 ${attachments.length} 个 PDF 附件，DOI 元数据更新 ${written} 个，页码对齐 ${pageLabelsAligned} 个，查看设置更新 ${viewerPreferencesUpdated} 个${skipped ? `，无变化或跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。耗时约 ${seconds} 秒。`;
			this.updateProgressWindow(progressWindow, "全库 PDF 更新完成", `DOI ${written}，页码 ${pageLabelsAligned}，查看设置 ${viewerPreferencesUpdated}，耗时约 ${seconds} 秒`, 6000);
			let result = { total: attachments.length, written, pageLabelsAligned, viewerPreferencesUpdated, skipped, message };
			if (options.silent) {
				return result;
			}
			if (options.softReport) {
				this.showSoftReport(message, 8000);
			}
			else {
				this.showPreferenceAlert("PDF DOI 元数据写入结果", message);
			}
			return result;
		},

		async lookupMetadataByDOI(doi) {
			return this.lookupMetadataByIdentifier({ type: "doi", value: doi });
		},

		async lookupMetadataByIdentifier(identifier) {
			let attempts = this.getIdentifierLookupAttempts(identifier);
			for (let attempt of attempts) {
				let translate = new Zotero.Translate.Search();
				try {
					translate.setIdentifier(attempt);
					let translators = await translate.getTranslators();
					if (!translators?.length) {
						continue;
					}
					translate.setTranslator(translators);
					let items = await translate.translate({ libraryID: false });
					if (items?.[0]) {
						return items[0];
					}
				}
				catch (e) {
					Zotero.debug(`ZotLink: identifier lookup attempt failed: ${e.message || e}`, 1);
				}
			}
			return null;
		},

		getIdentifierLookupAttempts(identifier) {
			let type = identifier?.type || "doi";
			let value = this.normalizeIdentifierValue(identifier);
			if (!value) {
				return [];
			}
			if (type === "isbn") {
				return [
					value,
					`ISBN ${value}`,
					{
						itemType: "book",
						ISBN: value
					}
				];
			}
			return [
				value,
				{
					itemType: "journalArticle",
					DOI: value
				}
			];
		},

		createItemFromTranslatedMetadata(metadata, identifier, pdfPath) {
			let itemType = metadata?.itemType || "journalArticle";
			if (identifier?.type === "isbn" && !metadata?.itemType) {
				itemType = "book";
			}
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
			if (identifier?.type === "doi" && !item.getField("DOI")) {
				item.setField("DOI", this.normalizeDOI(identifier.value));
			}
			if (identifier?.type === "isbn" && !item.getField("ISBN")) {
				item.setField("ISBN", this.normalizeISBN(identifier.value));
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
			let identifier = await this.extractIdentifierFromPDFMetadata(pdfPath);
			return identifier.type === "doi" ? identifier.value : "";
		},

		async extractIdentifierFromPDFMetadata(pdfPath) {
			let outputPath = this.getTempTextPath("zotlink-pdf-doi");
			let scriptPath = this.getTempTextPath("zotlink-pdf-doi").replace(/\.txt$/i, ".py");
			let script = [
				"import html, re, sys, zlib",
				"path, output = sys.argv[1], sys.argv[2]",
				"doi_re = re.compile(rb'10\\.\\d{4,9}/[-._;()/:A-Z0-9]+', re.I)",
				"isbn_label_re = re.compile(r'ISBN(?:-1[03])?[:=]?\\s*([0-9X][0-9X\\s-]{8,24}[0-9X])', re.I)",
				"isbn_run_re = re.compile(r'(?<!\\d)((?:97[89][0-9X\\s-]{10,24})|(?:[0-9][0-9X\\s-]{8,18}[0-9X]))(?!\\d)', re.I)",
				"ref_re = re.compile(rb'(\\d+)\\s+(\\d+)\\s+obj\\b')",
				"doi = ''",
				"isbn = ''",
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
				"def isbn_checksum_ok(value):",
				"    value = re.sub(r'[^0-9X]', '', value.upper())",
				"    if len(value) == 13 and value.startswith(('978', '979')):",
				"        total = sum((1 if i % 2 == 0 else 3) * int(ch) for i, ch in enumerate(value))",
				"        return total % 10 == 0",
				"    if len(value) == 10:",
				"        total = 0",
				"        for i, ch in enumerate(value):",
				"            n = 10 if ch == 'X' and i == 9 else (int(ch) if ch.isdigit() else -1)",
				"            if n < 0:",
				"                return False",
				"            total += (10 - i) * n",
				"        return total % 11 == 0",
				"    return False",
				"def clean_isbn(raw):",
				"    for text in decoded_texts(raw):",
				"        text = html.unescape(text)",
				"        candidates = []",
				"        candidates.extend(m.group(1) for m in isbn_label_re.finditer(text))",
				"        candidates.extend(m.group(1) for m in isbn_run_re.finditer(text))",
				"        for candidate in candidates:",
				"            value = re.sub(r'[^0-9X]', '', candidate.upper())",
				"            if isbn_checksum_ok(value):",
				"                return value",
				"    return ''",
				"def identifier_from_pikepdf(path):",
				"    try:",
				"        import pikepdf",
				"    except Exception:",
				"        return '', ''",
				"    chunks = []",
				"    try:",
				"        with pikepdf.Pdf.open(path) as pdf:",
				"            try:",
				"                info = pdf.docinfo or {}",
				"                for key, value in info.items():",
				"                    chunks.append(str(key))",
				"                    chunks.append(str(value))",
				"            except Exception:",
				"                pass",
				"            try:",
				"                with pdf.open_metadata() as meta:",
				"                    try:",
				"                        for key, value in meta.items():",
				"                            chunks.append(str(key))",
				"                            chunks.append(str(value))",
				"                    except Exception:",
				"                        chunks.append(str(meta))",
				"            except Exception:",
				"                pass",
				"    except Exception:",
				"        return '', ''",
				"    raw = '\\n'.join(chunks).encode('utf-8', 'ignore')",
				"    return clean(raw), clean_isbn(raw)",
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
				"def isbn_from_metadata_fields(raw):",
				"    for m in re.finditer(rb'/(?:isbn|ISBN|Isbn|prism:isbn|dc:identifier|Identifier)\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[^<>\\s]+>|[^/<>{}\\[\\]\\s]+)', raw, re.I):",
				"        found = clean_isbn(decode_pdf_value(m.group(1)))",
				"        if found:",
				"            return found",
				"    xml_patterns = [",
				"        r'<[^>]*(?:isbn|identifier)[^>]*>\\s*([^<]+)',",
				"        r'(?:isbn|ISBN|identifier)\\s*=\\s*[\\\"\\']([^\\\"\\']+)',",
				"        r'(?:isbn|ISBN|identifier)\\s*[:=]\\s*([^\\r\\n<>]+)'",
				"    ]",
				"    for text in decoded_texts(raw):",
				"        text = html.unescape(text)",
				"        for pat in xml_patterns:",
				"            for m in re.finditer(pat, text, re.I):",
				"                found = clean_isbn(m.group(1).encode('utf-8', 'ignore'))",
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
				"    return (b'/metadata' in low or b'/info' in low or b'xmpmeta' in low or b'rdf:' in low or b'prism:doi' in low or b'prism:isbn' in low or b'dc:identifier' in low or b'/doi' in low or b'/isbn' in low or b'/doi' in body.lower() or b'/isbn' in body.lower())",
				"doi, isbn = identifier_from_pikepdf(path)",
				"if doi or isbn:",
				"    with open(output, 'w', encoding='utf-8') as out:",
				"        if doi:",
				"            out.write('doi\\t' + doi)",
				"        else:",
				"            out.write('isbn\\t' + isbn)",
				"    sys.exit(0)",
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
				"    isbn = isbn_from_metadata_fields(stream) or isbn_from_metadata_fields(body)",
				"    if doi:",
				"        break",
				"# Metadata fallback: inspect objects that look like Info/XMP/custom metadata even if they were not referenced in the trailer/catalog pattern above.",
				"if not doi and not isbn:",
				"    for body in iter_object_bodies(data):",
				"        if not looks_like_metadata(body):",
				"            continue",
				"        stream = stream_data(body)",
				"        doi = doi_from_metadata_fields(stream) or doi_from_metadata_fields(body)",
				"        isbn = isbn_from_metadata_fields(stream) or isbn_from_metadata_fields(body)",
				"        if doi or isbn:",
				"            break",
				"with open(output, 'w', encoding='utf-8') as out:",
				"    if doi:",
				"        out.write('doi\\t' + doi)",
				"    elif isbn:",
				"        out.write('isbn\\t' + isbn)",
				"    else:",
				"        out.write('')"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(script));
				await this.execDiagnosticCommand("C:\\Windows\\pyw.exe", [
					"-3",
					scriptPath,
					pdfPath,
					outputPath
				]);
				let raw = String(await this.readCommandOutputFile(outputPath, "") || "").trim();
				let [type, ...parts] = raw.split("\t");
				let value = parts.join("\t");
				if (type === "doi") {
					return { type, value: this.normalizeDOI(value) };
				}
				if (type === "isbn") {
					return { type, value: this.normalizeISBN(value) };
				}
				return { type: "", value: "" };
			}
			catch (e) {
				Zotero.logError(e);
				return { type: "", value: "" };
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
				let parentID = this.getCollectionParentIDValue(collection);
				collection = parentID ? Zotero.Collections.get(parentID) : null;
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
					let parentID = this.getCollectionParentIDValue(collection);
					collection = parentID ? Zotero.Collections.get(parentID) : null;
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
				let parentID = this.getCollectionParentIDValue(collection);
				collection = parentID ? Zotero.Collections.get(parentID) : null;
			}
			return names.filter(Boolean);
		},

		async getCollectionPathByIDAsync(collectionID) {
			collectionID = Number(collectionID) || 0;
			if (!collectionID) {
				return [];
			}
			try {
				let rows = await Zotero.DB.queryAsync(
					"SELECT collectionID, collectionName, parentCollectionID FROM collections WHERE libraryID=?",
					[Zotero.Libraries.userLibraryID]
				);
				let byID = new Map();
				for (let row of rows || []) {
					let id = Number(row.collectionID || row.collectionid || row[0]);
					if (!id) {
						continue;
					}
					byID.set(id, {
						id,
						name: row.collectionName || row.collectionname || row[1] || "",
						parentID: row.parentCollectionID || row.parentcollectionid || row.parentCollectionId || row[2] || null
					});
				}
				let names = [];
				let current = byID.get(collectionID);
				let guard = new Set();
				while (current?.id && !guard.has(Number(current.id))) {
					guard.add(Number(current.id));
					if (current.name) {
						names.unshift(this.sanitizePathSegment(current.name));
					}
					let parentID = current.parentID ? Number(current.parentID) : null;
					current = parentID ? byID.get(parentID) : null;
				}
				if (names.length) {
					return names.filter(Boolean);
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
			return this.getCollectionPathByID(collectionID);
		},

		async syncAttachmentMirrors(attachment, options = {}) {
			if (!attachment?.isFileAttachment?.()) {
				return { changed: false, reason: "不是文件附件" };
			}

			let currentPath = attachment.getFilePath();
			if (!currentPath || !(await IOUtils.exists(currentPath))) {
				let relocatedPath = await this.getRelocatedPathForCollectionPathChanges(currentPath, options.collectionPathChanges);
				if (relocatedPath) {
					await this.updateAttachmentLinkedPath(attachment, relocatedPath);
					currentPath = relocatedPath;
				}
				else {
					return { changed: false, reason: "源文件不存在" };
				}
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

			let preferredCollectionID = options.preferredCollectionID
				|| this.getRelocatedPreferredCollectionID(currentPath, fileName, options.collectionPathChanges);
			let preferredPath = this.getPreferredPrimaryPath(desiredRecords, preferredCollectionID);
			let currentIsDesired = desiredPaths.some(path => this.pathsEqual(path, currentPath));
			let primaryPath = currentPath;
			let changed = false;
			let movePending = false;

			if (!currentIsDesired || (preferredPath && !this.pathsEqual(preferredPath, currentPath))) {
				let targetPrimaryPath = preferredPath || desiredPaths[0];
				let existingPrimary = await this.getExistingPathWithFileID(targetPrimaryPath, locator.fileID);
				let moveResult = existingPrimary
					? { path: existingPrimary, targetPath: existingPrimary, error: "" }
					: await this.movePrimaryAttachmentFile(currentPath, targetPrimaryPath, diagnostics);
				let replacement = moveResult.path;
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
				else {
					movePending = true;
					this.queuePendingAttachmentMove(attachment, {
						sourcePath: currentPath,
						targetPath: moveResult.targetPath || targetPrimaryPath,
						preferredCollectionID,
						lastError: moveResult.error || "附件文件暂时无法移动"
					});
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

			let recordChanged = !this.fileIDsEqual(record.fileID, locator.fileID)
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
			if (!movePending) {
				this.clearPendingAttachmentMove(attachment.key);
			}
			return {
				changed,
				movePending,
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

		getRelocatedPreferredCollectionID(currentPath, fileName, changes) {
			let root = this.getAttachmentMoveRoot();
			if (!root || !currentPath || !fileName) {
				return null;
			}
			for (let change of changes || []) {
				let oldPath = Array.isArray(change?.oldPath) ? change.oldPath.filter(Boolean) : [];
				if (!oldPath.length) {
					continue;
				}
				let oldFilePath = PathUtils.join(root, ...oldPath, fileName);
				if (this.pathsEqual(oldFilePath, currentPath)) {
					return Number(change.collectionID) || null;
				}
			}
			return null;
		},

		async getRelocatedPathForCollectionPathChanges(currentPath, changes) {
			let root = this.getAttachmentMoveRoot();
			if (!root || !currentPath) {
				return "";
			}
			let normalizedCurrent = this.normalizePathForCompare(currentPath);
			for (let change of changes || []) {
				let oldPath = Array.isArray(change?.oldPath) ? change.oldPath.filter(Boolean) : [];
				let newPath = Array.isArray(change?.newPath) ? change.newPath.filter(Boolean) : [];
				if (!oldPath.length || !newPath.length) {
					continue;
				}
				let oldDir = PathUtils.join(root, ...oldPath);
				let newDir = PathUtils.join(root, ...newPath);
				let normalizedOldDir = this.normalizePathForCompare(oldDir);
				if (!normalizedCurrent || !normalizedOldDir
					|| !(normalizedCurrent === normalizedOldDir || normalizedCurrent.startsWith(normalizedOldDir + "/"))) {
					continue;
				}
				let relative = currentPath.slice(String(oldDir).length).replace(/^[\\/]+/, "");
				let candidate = relative ? PathUtils.join(newDir, ...relative.split(/[\\/]+/).filter(Boolean)) : newDir;
				if (await IOUtils.exists(candidate)) {
					return candidate;
				}
			}
			return "";
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
					return { path: "", targetPath: desiredPath, error: "目标路径已存在且无法生成唯一文件名" };
				}
				desiredPath = uniquePath;
			}
			try {
				await IOUtils.move(sourcePath, desiredPath);
				return { path: desiredPath, targetPath: desiredPath, error: "" };
			}
			catch (e) {
				Zotero.logError(e);
				diagnostics.push(`主路径移动失败：${sourcePath} -> ${desiredPath}；${e.message || e}`);
				return { path: "", targetPath: desiredPath, error: String(e.message || e) };
			}
		},

		getPendingAttachmentMoves() {
			let raw = this.getPref("pendingAttachmentMoves", "{}");
			try {
				let tasks = JSON.parse(raw);
				return tasks && typeof tasks === "object" && !Array.isArray(tasks) ? tasks : {};
			}
			catch (e) {
				return {};
			}
		},

		setPendingAttachmentMoves(tasks) {
			this.setPref("pendingAttachmentMoves", JSON.stringify(tasks || {}));
		},

		queuePendingAttachmentMove(attachment, details = {}) {
			if (!attachment?.key) {
				return;
			}
			let tasks = this.getPendingAttachmentMoves();
			let previous = tasks[attachment.key] || {};
			tasks[attachment.key] = {
				itemID: attachment.id,
				libraryID: attachment.libraryID,
				key: attachment.key,
				sourcePath: details.sourcePath || attachment.getFilePath?.() || previous.sourcePath || "",
				targetPath: details.targetPath || previous.targetPath || "",
				preferredCollectionID: Number(details.preferredCollectionID) || previous.preferredCollectionID || null,
				attempts: Number(previous.attempts || 0) + 1,
				lastError: details.lastError || previous.lastError || "附件文件暂时无法移动",
				updatedAt: new Date().toISOString()
			};
			this.setPendingAttachmentMoves(tasks);
			this.schedulePendingAttachmentMoveRetry(15000);
		},

		clearPendingAttachmentMove(attachmentKey) {
			if (!attachmentKey) {
				return;
			}
			let tasks = this.getPendingAttachmentMoves();
			if (!Object.prototype.hasOwnProperty.call(tasks, attachmentKey)) {
				return;
			}
			delete tasks[attachmentKey];
			this.setPendingAttachmentMoves(tasks);
		},

		clearPendingAttachmentMoveRetryTimer() {
			if (this._pendingMoveRetryTimer) {
				clearTimeout(this._pendingMoveRetryTimer);
				this._pendingMoveRetryTimer = null;
			}
		},

		schedulePendingAttachmentMoveRetry(delay = 15000) {
			if (!Object.keys(this.getPendingAttachmentMoves()).length) {
				return;
			}
			this.clearPendingAttachmentMoveRetryTimer();
			this._pendingMoveRetryTimer = setTimeout(() => {
				this._pendingMoveRetryTimer = null;
				this.retryPendingAttachmentMoves().catch(e => Zotero.logError(e));
			}, Math.max(1000, Number(delay) || 15000));
		},

		async retryPendingAttachmentMoves() {
			if (this._retryingPendingMoves) {
				return;
			}
			this._retryingPendingMoves = true;
			let completed = 0;
			try {
				let tasks = this.getPendingAttachmentMoves();
				for (let task of Object.values(tasks)) {
					let attachment = null;
					try {
						attachment = task.itemID ? await Zotero.Items.getAsync(Number(task.itemID)) : null;
						if (!attachment?.isFileAttachment?.() && task.libraryID && task.key) {
							attachment = Zotero.Items.getByLibraryAndKey?.(Number(task.libraryID), task.key) || null;
						}
						if (!attachment?.isFileAttachment?.()) {
							this.clearPendingAttachmentMove(task.key);
							continue;
						}
						let result = await this.syncAttachmentMirrors(attachment, {
							preferredCollectionID: task.preferredCollectionID
						});
						if (!result.movePending && result.primaryPath) {
							completed++;
						}
					}
					catch (e) {
						Zotero.logError(e);
						if (attachment) {
							this.queuePendingAttachmentMove(attachment, {
								sourcePath: task.sourcePath,
								targetPath: task.targetPath,
								preferredCollectionID: task.preferredCollectionID,
								lastError: String(e.message || e)
							});
						}
					}
				}
			}
			finally {
				this._retryingPendingMoves = false;
			}
			if (completed) {
				this.showStatus(`ZotLink 已完成 ${completed} 个延后的附件移动`, 3500);
			}
			if (Object.keys(this.getPendingAttachmentMoves()).length) {
				this.schedulePendingAttachmentMoveRetry(15000);
			}
		},

		async getExistingPathWithFileID(path, fileID) {
			if (!path || !(await IOUtils.exists(path))) {
				return "";
			}
			let locator = await this.getWindowsFileID(path, { quiet: true });
			if (locator.fileID && this.fileIDsEqual(locator.fileID, fileID)) {
				return path;
			}
			return "";
		},

		getShortcutPathForTargetPath(targetPath) {
			return `${targetPath}.lnk`;
		},

		async ensureShortcutPath(targetPath, shortcutPath, diagnostics = []) {
			await IOUtils.makeDirectory(this.getParentPath(shortcutPath), { createAncestors: true });
			let renamedShortcut = await this.findShortcutByTargetInDirectory(this.getParentPath(shortcutPath), targetPath, diagnostics);
			if (renamedShortcut && !this.pathsEqual(renamedShortcut, shortcutPath)) {
				try {
					if (await IOUtils.exists(shortcutPath)) {
						await IOUtils.remove(shortcutPath);
					}
					await IOUtils.move(renamedShortcut, shortcutPath);
					return shortcutPath;
				}
				catch (e) {
					Zotero.logError(e);
					diagnostics.push(`重命名快捷方式失败：${renamedShortcut} -> ${shortcutPath}；${e.message || e}`);
				}
			}
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

		async findShortcutByTargetInDirectory(dir, targetPath, diagnostics = []) {
			if (!dir || !(await IOUtils.exists(dir))) {
				return "";
			}
			let children;
			try {
				children = await IOUtils.getChildren(dir);
			}
			catch (e) {
				Zotero.logError(e);
				return "";
			}
			for (let child of children) {
				if (!/\.lnk$/i.test(child || "")) {
					continue;
				}
				let shortcutTarget = await this.getShortcutTargetPath(child, diagnostics);
				if (this.pathsEqual(shortcutTarget, targetPath)) {
					return child;
				}
			}
			return "";
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
			return Boolean(locator.fileID && this.fileIDsEqual(locator.fileID, fileID));
		},

		// Legacy hardlink implementation retained for reference. It is no longer used by the default sync path.
		async ensureHardlinkPath(sourcePath, desiredPath, fileID, diagnostics = []) {
			await IOUtils.makeDirectory(this.getParentPath(desiredPath), { createAncestors: true });
			if (await IOUtils.exists(desiredPath)) {
				let locator = await this.getWindowsFileID(desiredPath, { quiet: true });
				if (locator.fileID && this.fileIDsEqual(locator.fileID, fileID)) {
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
			return this.findPathInFileIDMap(map, fileID);
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
			return Boolean(left.fileID && right.fileID && this.fileIDsEqual(left.fileID, right.fileID));
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
				let result = { total: 0, indexed: 0, skipped: 0, alreadyIndexed: 0 };
				if (options.silent) {
					return result;
				}
				if (options.softReport) {
					this.showSoftReport("个人库中未找到可记录机内码的文件附件", 5000);
				}
				else {
					this.showIndexReport("个人库中未找到可记录机内码的文件附件");
				}
				return result;
			}

			let index = this.getAttachmentFileIndex();
			let totalAttachments = attachments.length;
			let alreadyIndexed = 0;
			if (options.onlyMissing) {
				attachments = attachments.filter(attachment => {
					let hasFileID = Boolean(index[attachment.key]?.fileID);
					if (hasFileID) {
						alreadyIndexed++;
					}
					return !hasFileID;
				});
			}
			if (!attachments.length) {
				let message = `全库附件均已有机内码记录，共 ${alreadyIndexed} 个文件附件，无需补录。`;
				let result = { total: totalAttachments, indexed: 0, skipped: 0, alreadyIndexed, message };
				if (options.silent) {
					return result;
				}
				if (options.softReport) {
					this.showSoftReport(message, 5000);
				}
				else {
					this.showIndexReport(message);
				}
				return result;
			}
			let indexed = 0;
			let batchIndexed = 0;
			let fallbackIndexed = 0;
			let skipped = 0;
			let reasons = new Map();
			let startedAt = Date.now();
			let useProgressWindow = options.useProgressWindow !== false;
			let progressWindow = useProgressWindow
				? this.createProgressWindow("正在初始化附件机内码", `已处理 0 / ${attachments.length}`)
				: null;
			if (options.softReport && !options.suppressSoftProgress) {
				this.showStatus(`正在初始化附件机内码：共 ${attachments.length} 个文件附件`, 2500);
			}
			let paths = attachments.map(attachment => attachment.getFilePath?.() || "");
			let batchLocators = await this.getWindowsFileIDsWithPython(paths);

			for (let i = 0; i < attachments.length; i++) {
				let attachment = attachments[i];
				try {
					let path = attachment.getFilePath();
					let locator = path ? batchLocators.get(this.normalizePathForCompare(path)) : null;
					let result = locator?.fileID
						? this.recordAttachmentFileID(attachment, path, locator.fileID, {
							index,
							save: false
						})
						: await this.indexAttachmentFileID(attachment, {
							quiet: true,
							index,
							save: false
						});
					if (result.ok) {
						indexed++;
						if (locator?.fileID) {
							batchIndexed++;
						}
						else {
							fallbackIndexed++;
						}
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
				if (processed === 1 || processed === attachments.length || processed % 50 === 0) {
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
			let savedCount = Object.keys(this.getAttachmentFileIndex()).length;
			let seconds = Math.round((Date.now() - startedAt) / 1000);
			let reasonText = this.formatReasons(reasons);
			let message = `全库附件机内码更新完成：共检查 ${totalAttachments} 个文件附件，原有 ${alreadyIndexed} 个，本次记录 ${indexed} 个（批量读取 ${batchIndexed}，单项补读 ${fallbackIndexed}；索引现有 ${savedCount} 条）${skipped ? `，跳过 ${skipped} 个${reasonText ? "：" + reasonText : ""}` : ""}。耗时约 ${seconds} 秒。`;
			this.updateProgressWindow(progressWindow, "附件机内码初始化完成", `已记录 ${indexed}，跳过 ${skipped}，耗时约 ${seconds} 秒`, 6000);
			let result = { total: totalAttachments, indexed, skipped, alreadyIndexed, batchIndexed, fallbackIndexed, savedCount, message };
			if (options.silent) {
				return result;
			}
			if (options.softReport) {
				this.setPref("lastIndexReport", message);
				this.showSoftReport(message, 8000);
			}
			else {
				this.showIndexReport(message);
			}
			return result;
		},

		showIndexReport(message) {
			this.setPref("lastIndexReport", message);
			this.showPreferenceAlert("附件机内码初始化结果", message);
		},

		createProgressWindow(title, message) {
			try {
				let progressWindow = new Zotero.ProgressWindow();
				progressWindow.changeHeadline(this.formatProgressWindowTitle(title));
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
				progressWindow.changeHeadline(this.formatProgressWindowTitle(title));
				progressWindow.addDescription(message);
				if (closeAfter) {
					progressWindow.startCloseTimer(closeAfter);
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		closeProgressWindow(progressWindow) {
			if (!progressWindow) {
				return;
			}
			try {
				if (typeof progressWindow.close === "function") {
					progressWindow.close();
				}
				else if (typeof progressWindow.startCloseTimer === "function") {
					progressWindow.startCloseTimer(1);
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
		},

		formatProgressWindowTitle(title) {
			title = String(title || "").trim();
			if (!title) {
				return "ZotLink";
			}
			if (/^ZotLink\b/i.test(title)) {
				return title;
			}
			return `ZotLink - ${title}`;
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

			return this.recordAttachmentFileID(attachment, path, locator.fileID, options);
		},

		recordAttachmentFileID(attachment, path, fileID, options = {}) {
			let index = options.index || this.getAttachmentFileIndex();
			let existing = this.normalizeAttachmentIndexRecord(attachment, index[attachment.key]);
			index[attachment.key] = {
				...existing,
				itemID: attachment.id,
				key: attachment.key,
				fileID,
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
				fileID,
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

			let pythonLocator = await this.getWindowsFileIDWithPython(path);
			if (pythonLocator.fileID) {
				return pythonLocator;
			}

			let escapedPath = this.escapePowerShellSingleQuotedString(path);
			let outputPath = this.getTempTextPath("zotlink-fileid");
			let escapedOutputPath = this.escapePowerShellSingleQuotedString(outputPath);
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
			let diagnostics = [pythonLocator.diagnostics].filter(Boolean);
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
			let pythonLocator = await this.getWindowsFileIDWithPython(path);
			if (pythonLocator.fileID) {
				return pythonLocator;
			}

			let outputPath = this.getTempTextPath("zotlink-fileid");
			let escapedPath = this.escapePowerShellSingleQuotedString(path);
			let escapedOutputPath = this.escapePowerShellSingleQuotedString(outputPath);
			let script = `fsutil file queryfileid '${escapedPath}' 2>&1 | Out-File -LiteralPath '${escapedOutputPath}' -Encoding utf8`;
			try {
				let text = await this.runHiddenPowerShellToOutput(script, outputPath);
				let fileID = this.parseWindowsFileID(text);
				return {
					fileID,
					diagnostics: [pythonLocator.diagnostics, text].filter(Boolean).join("\n\n")
				};
			}
			catch (e) {
				Zotero.logError(e);
				return {
					fileID: "",
					diagnostics: [pythonLocator.diagnostics, this.errorToText(e)].filter(Boolean).join("\n\n")
				};
			}
		},

		async getWindowsFileIDWithPython(path) {
			let scriptPath = this.getTempTextPath("zotlink-fileid-python").replace(/\.txt$/i, ".py");
			let outputPath = this.getTempTextPath("zotlink-fileid-python");
			let diagnostics = [];
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(this.getPythonFileIDScript()));
				for (let command of ["C:\\Windows\\pyw.exe", "C:\\Windows\\py.exe"]) {
					let result = await this.execDiagnosticCommand(command, [
						"-3",
						scriptPath,
						path,
						outputPath
					], outputPath);
					let fileID = this.parseWindowsFileID(result.text);
					diagnostics.push(`${fileID ? "[OK]" : "[NO MATCH]"} ${result.diagnostic}`);
					if (fileID) {
						return {
							fileID,
							diagnostics: diagnostics.join("\n\n")
						};
					}
				}
			}
			catch (e) {
				Zotero.logError(e);
				diagnostics.push(`[ERROR] Python file-id helper\n${this.errorToText(e)}`);
			}
			finally {
				for (let tempPath of [scriptPath, outputPath]) {
					try {
						if (await IOUtils.exists(tempPath)) {
							await IOUtils.remove(tempPath);
						}
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
			}
			return {
				fileID: "",
				diagnostics: diagnostics.join("\n\n")
			};
		},

		async getWindowsFileIDsWithPython(paths) {
			let normalizedPaths = (paths || [])
				.map(path => String(path || ""))
				.filter(Boolean);
			let results = new Map();
			if (!normalizedPaths.length) {
				return results;
			}

			let scriptPath = this.getTempTextPath("zotlink-fileid-batch").replace(/\.txt$/i, ".py");
			let inputPath = this.getTempTextPath("zotlink-fileid-batch-input");
			let outputPath = this.getTempTextPath("zotlink-fileid-batch-output");
			let script = [
				"import ctypes, json, sys, traceback",
				"input_path, output_path = sys.argv[1], sys.argv[2]",
				"kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)",
				"FILE_SHARE_READ = 0x00000001",
				"FILE_SHARE_WRITE = 0x00000002",
				"FILE_SHARE_DELETE = 0x00000004",
				"OPEN_EXISTING = 3",
				"FILE_FLAG_BACKUP_SEMANTICS = 0x02000000",
				"INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value",
				"class FILETIME(ctypes.Structure):",
				"    _fields_ = [('dwLowDateTime', ctypes.c_uint32), ('dwHighDateTime', ctypes.c_uint32)]",
				"class BY_HANDLE_FILE_INFORMATION(ctypes.Structure):",
				"    _fields_ = [('dwFileAttributes', ctypes.c_uint32), ('ftCreationTime', FILETIME), ('ftLastAccessTime', FILETIME), ('ftLastWriteTime', FILETIME), ('dwVolumeSerialNumber', ctypes.c_uint32), ('nFileSizeHigh', ctypes.c_uint32), ('nFileSizeLow', ctypes.c_uint32), ('nNumberOfLinks', ctypes.c_uint32), ('nFileIndexHigh', ctypes.c_uint32), ('nFileIndexLow', ctypes.c_uint32)]",
				"kernel32.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]",
				"kernel32.CreateFileW.restype = ctypes.c_void_p",
				"kernel32.GetFileInformationByHandle.argtypes = [ctypes.c_void_p, ctypes.POINTER(BY_HANDLE_FILE_INFORMATION)]",
				"kernel32.GetFileInformationByHandle.restype = ctypes.c_int",
				"kernel32.CloseHandle.argtypes = [ctypes.c_void_p]",
				"kernel32.CloseHandle.restype = ctypes.c_int",
				"def read_one(path):",
				"    handle = kernel32.CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, None, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None)",
				"    if handle == INVALID_HANDLE_VALUE:",
				"        raise ctypes.WinError(ctypes.get_last_error())",
				"    try:",
				"        info = BY_HANDLE_FILE_INFORMATION()",
				"        if not kernel32.GetFileInformationByHandle(handle, ctypes.byref(info)):",
				"            raise ctypes.WinError(ctypes.get_last_error())",
				"        file_id = (info.nFileIndexHigh << 32) | info.nFileIndexLow",
				"        return '0x%08x:0x%016x' % (info.dwVolumeSerialNumber, file_id)",
				"    finally:",
				"        kernel32.CloseHandle(handle)",
				"with open(input_path, 'r', encoding='utf-8') as f:",
				"    paths = json.load(f)",
				"out = {}",
				"for path in paths:",
				"    try:",
				"        out[path] = {'fileID': read_one(path)}",
				"    except Exception as e:",
				"        out[path] = {'error': ''.join(traceback.format_exception_only(type(e), e)).strip()}",
				"with open(output_path, 'w', encoding='utf-8') as f:",
				"    json.dump(out, f, ensure_ascii=False)"
			].join("\n");
			try {
				await IOUtils.write(scriptPath, new TextEncoder().encode(script));
				await IOUtils.write(inputPath, new TextEncoder().encode(JSON.stringify(normalizedPaths)));
				for (let command of ["C:\\Windows\\pyw.exe", "C:\\Windows\\py.exe"]) {
					let execResult = await this.execDiagnosticCommand(command, [
						"-3",
						scriptPath,
						inputPath,
						outputPath
					], outputPath);
					let text = execResult.text || "";
					let data = {};
					try {
						data = JSON.parse(text || "{}");
					}
					catch (e) {
						Zotero.debug(`ZotLink: batch file-id output parse failed for ${command}: ${this.errorToText(e)} ${text}`, 1);
					}
					for (let [path, value] of Object.entries(data || {})) {
						if (value?.fileID) {
							results.set(this.normalizePathForCompare(path), {
								fileID: String(value.fileID).toLowerCase()
							});
						}
					}
					if (results.size) {
						break;
					}
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
			finally {
				for (let tempPath of [scriptPath, inputPath, outputPath]) {
					try {
						if (await IOUtils.exists(tempPath)) {
							await IOUtils.remove(tempPath);
						}
					}
					catch (e) {
						Zotero.logError(e);
					}
				}
			}
			return results;
		},

		parseWindowsFileID(text) {
			text = String(text || "");
			let match = text.match(/FILEID\s+([0-9a-fx:]+)/i)
				|| text.match(/File\s+ID\s+is\s+([0-9a-fx:]+)/i)
				|| text.match(/((?:0x)?[0-9a-f]+:(?:0x)?[0-9a-f]+)/i);
			return match ? match[1].toLowerCase() : "";
		},

		normalizeFileIDForCompare(fileID) {
			return String(fileID || "").trim().toLowerCase();
		},

		getFileIDLookupKeys(fileID) {
			let value = this.normalizeFileIDForCompare(fileID);
			if (!value) {
				return [];
			}
			let keys = [value];
			if (value.includes(":")) {
				let parts = value.split(":").filter(Boolean);
				let last = parts[parts.length - 1];
				if (last) {
					keys.push(last);
				}
			}
			return Array.from(new Set(keys));
		},

		fileIDsEqual(left, right) {
			let leftKeys = new Set(this.getFileIDLookupKeys(left));
			return this.getFileIDLookupKeys(right).some(key => leftKeys.has(key));
		},

		addFileIDMapEntry(map, fileID, filePath) {
			if (!filePath) {
				return;
			}
			for (let key of this.getFileIDLookupKeys(fileID)) {
				if (key && !map.has(key)) {
					map.set(key, filePath);
				}
			}
		},

		findPathInFileIDMap(map, fileID) {
			for (let key of this.getFileIDLookupKeys(fileID)) {
				let path = map.get(key);
				if (path) {
					return path;
				}
			}
			return "";
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
    output = "FILEID 0x%08x:0x%016x" % (info.dwVolumeSerialNumber, file_id)
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write(output)
    else:
        print(output)
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
				let fileID = this.parseWindowsFileID(text);
				return {
					fileID,
					diagnostic: `[${fileID ? "OK" : "NO MATCH"}] ${label}\n${this.truncateDiagnostic(text)}`
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
					text,
					diagnostic: `[OK] ${label}\n${this.truncateDiagnostic(text)}`
				};
			}
			catch (e) {
				Zotero.logError(e);
				let text = outputFile ? await this.readCommandOutputFile(outputFile, "") : "";
				return {
					ok: false,
					text,
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

		async repairAllLibraryAttachmentLinksByFileID(options = {}) {
			let root = this.getAttachmentMoveRoot();
			if (!root || !(await IOUtils.exists(root))) {
				if (!options.silent) {
					this.showSoftReport("附件顶层路径不存在，无法检查全库附件链接。", 7000);
				}
				return { total: 0, repaired: 0, indexed: 0, outsideRoot: 0, unresolved: 0 };
			}

			let attachments = await this.getAllUserFileAttachments();
			let index = this.getAttachmentFileIndex();
			let indexed = 0;
			let repaired = 0;
			let outsideRoot = 0;
			let unresolved = 0;
			let reasons = new Map();
			this._fileIDMapCache = null;

			for (let i = 0; i < attachments.length; i++) {
				let attachment = attachments[i];
				try {
					let record = this.normalizeAttachmentIndexRecord(attachment, index[attachment.key]);
					if (!record?.fileID) {
						let result = await this.indexAttachmentFileID(attachment, {
							quiet: true,
							index,
							save: false
						});
						if (result.ok) {
							indexed++;
							record = this.normalizeAttachmentIndexRecord(attachment, index[attachment.key]);
						}
						else {
							unresolved++;
							this.countReason(reasons, result.reason || "无法记录机内码");
							continue;
						}
					}

					let result = await this.repairAttachmentLinkByFileID(attachment, {
						silent: true,
						index,
						notifyOutsideRoot: false
					});
					if (result.ok) {
						repaired++;
					}
					else if (result.outsideRoot) {
						outsideRoot++;
					}
					else if (!result.current) {
						unresolved++;
						this.countReason(reasons, result.reason || "无法定位附件");
					}
				}
				catch (e) {
					Zotero.logError(e);
					unresolved++;
					this.countReason(reasons, e.message || "异常");
				}

				let processed = i + 1;
				if (processed === 1 || processed === attachments.length || processed % 10 === 0) {
					options.onProgress?.({ processed, total: attachments.length });
				}
			}

			this.setAttachmentFileIndex(index);
			let reasonText = this.formatReasons(reasons);
			let message = `全库附件链接检查完成：共检查 ${attachments.length} 个附件，补录机内码 ${indexed} 个，修复链接 ${repaired} 个，根目录外 ${outsideRoot} 个，无法定位 ${unresolved} 个${reasonText ? "：" + reasonText : ""}。`;
			if (!options.silent) {
				this.showSoftReport(message, 10000);
			}
			return { total: attachments.length, repaired, indexed, outsideRoot, unresolved, message };
		},

		async repairAttachmentLinkByFileID(attachment, options = {}) {
			let root = this.getAttachmentMoveRoot();
			if (!root || !(await IOUtils.exists(root))) {
				return { ok: false, reason: "附件顶层路径不存在" };
			}

			if (!attachment?.isFileAttachment?.()) {
				return { ok: false, reason: "不是文件附件" };
			}

			let index = options.index || this.getAttachmentFileIndex();
			let record = this.normalizeAttachmentIndexRecord(attachment, index[attachment.key]);
			if (!record?.fileID) {
				return { ok: false, reason: "没有已记录机内码" };
			}

			let fileID = this.normalizeFileIDForCompare(record.fileID);
			let currentPath = attachment.getFilePath();
			if (currentPath && await IOUtils.exists(currentPath)) {
				let currentLocator = await this.getWindowsFileID(currentPath, { quiet: true });
				if (currentLocator.fileID && this.fileIDsEqual(currentLocator.fileID, fileID)) {
					if (!this.isPathInsideRoot(currentPath, root)) {
						if (options.notifyOutsideRoot) {
							this.showStatus(`附件已移出 ZotLink 顶层路径：${currentPath}`, 9000);
						}
						return { ok: false, current: true, outsideRoot: true, path: currentPath, reason: "附件位于顶层路径外" };
					}
					if (!this.pathsEqual(record.primaryPath, currentPath)) {
						this.updateAttachmentFileIndexPath(attachment, record, currentPath, index, !options.index);
					}
					await this.syncItemCollectionFromAttachmentPath(attachment, currentPath, root);
					return { ok: false, current: true, reason: "当前链接未丢失" };
				}
			}

			let foundPath = await this.findFileByRecordedID(fileID, root, record, options);
			if (!foundPath) {
				foundPath = await this.findFileOutsideRootByRecordedID(fileID, record);
			}
			if (!foundPath) {
				return { ok: false, reason: "未找到匹配机内码的文件" };
			}
			if (!this.isPathInsideRoot(foundPath, root)) {
				if (options.notifyOutsideRoot) {
					this.showStatus(`附件已移出 ZotLink 顶层路径：${foundPath}`, 9000);
				}
				return { ok: false, outsideRoot: true, path: foundPath, reason: "附件位于顶层路径外" };
			}

			await this.updateAttachmentLinkedPath(attachment, foundPath);
			this.updateAttachmentFileIndexPath(attachment, record, foundPath, index, !options.index);
			let collectionID = await this.syncItemCollectionFromAttachmentPath(attachment, foundPath, root);
			await this.syncAttachmentMirrors(attachment, {
				index,
				save: false,
				preferredCollectionID: collectionID || undefined
			});
			if (!options.index) {
				this.setAttachmentFileIndex(index);
			}
			Zotero.getActiveZoteroPane()?.itemsView?.refreshAndMaintainSelection?.();
			if (!options.silent) {
				this.showStatus("已自动修复附件链接");
			}
			return { ok: true, path: foundPath };
		},

		isPathInsideRoot(path, root) {
			let normalizedPath = this.normalizePathForCompare(path);
			let normalizedRoot = this.normalizePathForCompare(root);
			return Boolean(normalizedPath && normalizedRoot
				&& (normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + "/")));
		},

		async syncItemCollectionFromAttachmentPath(attachment, path, root) {
			if (!this.isPathInsideRoot(path, root)) {
				return null;
			}
			let parent = attachment?.parentItem;
			if (!parent?.isRegularItem?.()) {
				return null;
			}
			let normalizedRoot = String(root || "").replace(/[\\/]+$/g, "");
			let parentPath = this.getParentPath(path);
			let relative = parentPath.slice(normalizedRoot.length).replace(/^[\\/]+/, "");
			let segments = relative.split(/[\\/]+/).map(value => value.trim()).filter(Boolean);
			if (!segments.length) {
				return null;
			}
			let collectionID = await this.ensureCollectionPath(null, segments, new Map([["", null]]), new Map());
			if (!collectionID) {
				return null;
			}
			let existing = new Set((parent.getCollections?.() || []).map(Number));
			if (!existing.has(Number(collectionID))) {
				parent.addToCollection(collectionID);
				await parent.saveTx();
			}
			return Number(collectionID);
		},

		async findFileOutsideRootByRecordedID(fileID, record) {
			let idParts = this.normalizeFileIDForCompare(fileID).split(":").filter(Boolean);
			let nativeFileID = idParts[idParts.length - 1] || "";
			if (!nativeFileID) {
				return "";
			}
			let drives = new Set();
			for (let path of [record?.primaryPath, record?.path, ...(record?.shortcutPaths || []), ...(record?.hardlinkPaths || [])]) {
				let match = String(path || "").match(/^([a-z]:)/i);
				if (match) {
					drives.add(match[1].toUpperCase());
				}
			}
			for (let drive of drives) {
				let result = await this.execDiagnosticCommand("C:\\Windows\\System32\\fsutil.exe", [
					"file",
					"queryFileNameById",
					drive,
					nativeFileID
				]);
				let match = String(result.text || "").match(/(?:\\\\\?\\)?([A-Z]:\\[^\r\n]+)/i);
				let path = match ? match[1].trim() : "";
				if (path && await IOUtils.exists(path)) {
					return path;
				}
			}
			return "";
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
				let foundPath = this.findPathInFileIDMap(map, fileID);
				if (foundPath) {
					return foundPath;
				}
			}
			return "";
		},

		updateAttachmentFileIndexPath(attachment, record, path, index = null, save = true) {
			index = index || this.getAttachmentFileIndex();
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
			if (save) {
				this.setAttachmentFileIndex(index);
			}
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

			let paths;
			try {
				paths = await this.listFilesRecursive(root);
			}
			catch (e) {
				Zotero.logError(e);
				throw new Error("扫描目录文件失败：" + this.errorToText(e));
			}

			let fileIDs = new Map();
			let locators = await this.getWindowsFileIDsWithPython(paths);
			for (let filePath of paths) {
				let locator = locators.get(this.normalizePathForCompare(filePath));
				if (locator?.fileID) {
					this.addFileIDMapEntry(fileIDs, locator.fileID, filePath);
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
