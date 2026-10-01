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

	for (let win of Zotero.getMainWindows()) {
		Zotero.ZotLink?.onMainWindowUnload(win);
	}

	await Zotero.ZotLink?.shutdown();
	delete Zotero.ZotLink;
	ZotLinkData = null;
}

function uninstall() {}

function onMainWindowLoad({ window }) {
	Zotero.ZotLink?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
	Zotero.ZotLink?.onMainWindowUnload(window);
}
