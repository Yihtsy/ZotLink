"use strict";

var ZotLinkData;

function install() {}

async function startup(data, reason) {
	ZotLinkData = data;
	Zotero.debug("ZotLink bootstrap startup");

	Services.scriptloader.loadSubScript(
		data.rootURI + "content/zotlink.js",
		Zotero.getMainWindow()
	);

	await Zotero.ZotLink.startup(data);

	for (let win of Zotero.getMainWindows()) {
		Zotero.ZotLink.onMainWindowLoad(win);
	}
}

async function shutdown(data, reason) {
	if (reason === APP_SHUTDOWN) {
		return;
	}
	if (reason === ADDON_UNINSTALL || reason === ADDON_DISABLE) {
		await Zotero.ZotLink?.removeWindowsFolderMenu();
	}

	for (let win of Zotero.getMainWindows()) {
		Zotero.ZotLink?.onMainWindowUnload(win);
	}

	await Zotero.ZotLink?.shutdown();
	delete Zotero.ZotLink;
	ZotLinkData = null;
}

async function uninstall(data, reason) {
	if (reason !== ADDON_UNINSTALL || !Zotero.isWin) return;
	if (!Zotero.ZotLink) {
		Services.scriptloader.loadSubScript(data.rootURI + "content/zotlink.js", Zotero.getMainWindow());
		try { await Zotero.ZotLink.removeWindowsFolderMenu(); }
		finally { delete Zotero.ZotLink; }
	} else {
		await Zotero.ZotLink.removeWindowsFolderMenu();
	}
}

function onMainWindowLoad({ window }) {
	Zotero.ZotLink?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
	Zotero.ZotLink?.onMainWindowUnload(window);
}
