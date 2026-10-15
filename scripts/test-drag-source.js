"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "content", "zotlink.js"), "utf8");
const context = {
	Zotero: { logError() {} },
	console,
	setTimeout,
	clearTimeout
};
vm.createContext(context);
vm.runInContext(source, context, { filename: "content/zotlink.js" });

const plugin = context.Zotero.ZotLink;
const doc = {};
const makeNode = (id, parentNode = doc) => ({
	id,
	className: "",
	parentNode,
	getAttribute() {
		return "";
	}
});

assert.strictEqual(
	plugin.getZoteroDragSourceKind({
		dataTransfer: { types: ["zotero/collection"] },
		target: makeNode("item-tree-main-default")
	}, { document: doc }),
	"collection",
	"Zotero drag MIME type must take priority over DOM fallback"
);

assert.strictEqual(
	plugin.getZoteroDragSourceKind({
		dataTransfer: { types: [] },
		target: makeNode("collection-tree")
	}, { document: doc }),
	"collection",
	"Collection tree drag must be classified as a collection"
);

assert.strictEqual(
	plugin.getZoteroDragSourceKind({
		dataTransfer: { types: [] },
		target: makeNode("item-tree-main-default")
	}, { document: doc }),
	"item",
	"Item tree drag must be classified as an item"
);

assert.deepStrictEqual(
	Array.from(plugin.getNotifierItemIDs("add", "collection-item", ["38-59498"], {})),
	[59498],
	"collection-item notifier IDs must resolve to the item half"
);

assert.deepStrictEqual(
	Array.from(plugin.getNotifierItemIDs("modify", "item", ["59498"], {})),
	[59498],
	"item notifier IDs must be normalized to numbers"
);

assert.strictEqual(
	plugin.isCollectionMembershipChangeNotification("modify", "item", [59498], {
		59498: { changed: { collections: [] } }
	}),
	true,
	"Right-side collection membership edits must trigger mirror synchronization"
);

context.Zotero.Item = function () {};
context.Zotero.Item.prototype.getCollections = function () {
	return this.collections;
};
const originalSetCollections = function (collectionIDs) {
	this.collections = collectionIDs;
};
context.Zotero.Item.prototype.setCollections = originalSetCollections;
let scheduledItemIDs = [];
let scheduledOptions = [];
let statusMessages = [];
plugin.showStatus = message => {
	statusMessages.push(message);
};
plugin.scheduleAttachmentFileIDIndexing = (itemIDs, options = {}) => {
	scheduledItemIDs.push(...itemIDs);
	scheduledOptions.push(options);
};
plugin.registerCollectionMembershipHook();
const item = new context.Zotero.Item();
item.id = 59498;
item.collections = [38];
item.setCollections([38, 41]);
assert.deepStrictEqual(
	scheduledItemIDs,
	[59498],
	"setCollections changes must schedule the parent item for mirror synchronization"
);
assert.strictEqual(
	scheduledOptions[0]?.membershipSource,
	"setCollections",
	"setCollections changes must retain their diagnostic trigger source"
);
assert.strictEqual(statusMessages.length, 0, "Membership hooks must not show temporary diagnostic popups");
plugin.unregisterCollectionMembershipHook();
assert.strictEqual(
	context.Zotero.Item.prototype.setCollections,
	originalSetCollections,
	"Unregistering must restore Zotero's original setCollections method"
);

if (process.platform === "win32") {
	const { spawnSync } = require("child_process");
	const filename = "Parkinson\u2019s O'Brien \u2018study\u2019 [J].pdf";
	const escaped = plugin.escapePowerShellSingleQuotedString(filename);
	const result = spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-Command",
		`$s = '${escaped}'; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s))`
	], { encoding: "utf8", windowsHide: true });
	assert.strictEqual(result.status, 0, result.error?.message || result.stderr);
	assert.strictEqual(Buffer.from(result.stdout.trim(), "base64").toString("utf8"), filename);
}

console.log("Drag source, membership and PowerShell filename regressions passed");
