"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const context = { Zotero: { logError() {}, Libraries: { userLibraryID: 1 } }, TextEncoder, TextDecoder,
	Services: { io: { newURI(value) { return value; }, newChannelFromURI(uri) { return { uri }; } },
		scriptSecurityManager: { getSystemPrincipal() { return {}; } } },
	Components: { interfaces: { nsILoadInfo: { SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL: 1 }, nsIContentPolicy: { TYPE_OTHER: 1 } } },
    PathUtils: { normalize: path.win32.normalize, filename: path.win32.basename, join: path.win32.join, tempDir: "C:\\temp" } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../content/zotlink.js"), "utf8"), context);
const plugin = context.Zotero.ZotLink;
async function run(folder, expectedOK) {
    const request = "C:\\ipc\\" + "a".repeat(32) + ".request.json";
    const outputs = [];
    const created = [];
    const selected = [];
    plugin.getWindowsFolderMenuDirectory = () => "C:\\ipc";
    plugin.getAttachmentMoveRoot = () => "D:\\Archive";
    plugin.showStatus = () => {};
    plugin.ensureCollectionPath = async (parent, segments) => { created.push(Array.from(segments)); return 123; };
    context.Zotero.getMainWindow = () => ({ focus() {}, ZoteroPane: { collectionsView: {
        async selectByID(id) { selected.push(id); return true; }
    } } });
    context.IOUtils = {
        async exists() { return true; }, async getChildren() { return [request]; },
        async stat() { return { type: "directory" }; }, async remove() {},
        async read() { return new TextEncoder().encode(JSON.stringify({ path: folder, createdAt: Date.now() })); },
        async write(file, bytes) { outputs.push(JSON.parse(new TextDecoder().decode(bytes))); }
    };
    await plugin.processWindowsFolderRequests();
    assert.strictEqual(outputs[0].ok, expectedOK);
    assert.strictEqual(plugin._windowsFolderBusy, false);
    if (!expectedOK) assert.strictEqual(created.length, 0, "Outside-root paths must not create collections");
    return { created, selected };
}
(async () => {
    const written = [];
    const nativeScripts = [];
    context.Zotero.File = { async getContentsAsync(channel, charset) {
        assert.strictEqual(typeof channel, "object", "XPI resources must use a native channel, not HTTP URI parsing");
        assert.strictEqual(charset, "UTF-8");
        if (channel.uri.endsWith("content/windows-folder.ps1")) return "param([string]$Folder)\n# helper";
        assert.ok(channel.uri.includes("content/windows-pdf/") && channel.uri.endsWith(".py"));
        return "# bundled PDF helper";
    } };
    context.IOUtils = { async makeDirectory() {}, async write(file, bytes) { written.push({ file, bytes }); } };
    plugin._rootURI = "jar:file:///plugin.xpi!/";
    plugin.getAttachmentMoveRoot = () => "D:\\Archive";
    plugin.getWindowsFolderMenuDirectory = () => "C:\\ipc";
    plugin.runHiddenPowerShellToOutput = async script => {
        nativeScripts.push(script);
        if (script.includes("SystemFileAssociations")) {
            for (const name of ["Update DOI metadata only", "Rename article/book", "Align PDF page labels"]) assert.ok(script.includes(name));
            assert.ok(script.includes("GetValue('')"));
        } else {
            assert.ok(script.includes("HKCU:\\Software\\Classes\\Directory\\shell\\ZotLinkLocateCollection"));
            assert.ok(script.includes("AppliesTo"), "Registration and root updates must apply visibility conditions");
        }
        return "OK";
    };
    await plugin.installWindowsFolderMenu();
    assert.strictEqual(plugin.getWindowsFolderMenuCondition(), '(System.ItemPathDisplay:="D:\\Archive" OR System.ItemPathDisplay:~<"D:\\Archive\\")');
    plugin.getAttachmentMoveRoot = () => "D:\\New Root\\";
    assert.ok(plugin.getWindowsFolderMenuCondition().includes('D:\\New Root\\"'), "Changed roots must replace visibility scope with a directory boundary");
    assert.ok(written.some(entry => entry.file.endsWith("folder.ps1")));
    assert.ok(written.some(entry => entry.file.endsWith("folder.vbs")));
    assert.ok(written.some(entry => entry.file.endsWith("pdf.vbs")));
    assert.ok(written.some(entry => entry.file.endsWith("runner.py")));
    assert.ok(written.some(entry => entry.file.endsWith("root.json") && JSON.parse(new TextDecoder().decode(entry.bytes)).root === "D:\\Archive"));
    assert.ok(written.some(entry => entry.file.endsWith("zotlink-windows-menu-registration-latest.txt")));
    const registerScript = nativeScripts.find(script => script.includes("SystemFileAssociations"));
    assert.ok(registerScript.includes("01_DOI") && registerScript.includes("02_Rename") && registerScript.includes("03_Labels"));
    if (process.argv.includes("--emit-scripts")) {
        const target = path.join(__dirname, "../.tmp-menu-tests");
        fs.mkdirSync(target, { recursive: true });
        nativeScripts.forEach((script, index) => fs.writeFileSync(path.join(target, `${index}.ps1`), Buffer.concat([Buffer.from([255, 254]), Buffer.from(script, "utf16le")])));
        for (const entry of written.filter(entry => entry.file.endsWith(".vbs"))) fs.writeFileSync(path.join(target, path.win32.basename(entry.file)), entry.bytes);
    }
    const scriptsBeforeRemoval = nativeScripts.length;
    context.IOUtils.exists = async () => false;
    context.Zotero.isWin = true;
    // Capture the cleanup script without actually touching the Windows registry.
    const previousExecutor = plugin.runHiddenPowerShellToOutput;
    plugin.runHiddenPowerShellToOutput = async script => { nativeScripts.push(script); return "OK"; };
    await plugin.removeWindowsFolderMenu();
    const cleanupScript = nativeScripts[scriptsBeforeRemoval];
    assert.ok(cleanupScript.includes("SystemFileAssociations\\.pdf\\shell\\ZotLink"));
    assert.ok(cleanupScript.includes("Directory\\shell\\ZotLinkLocateCollection"));
    plugin.runHiddenPowerShellToOutput = previousExecutor;
    const match = await run("D:\\Archive\\Parent\\Child", true);
    assert.deepStrictEqual(match.created, [["Parent", "Child"]]);
    assert.deepStrictEqual(match.selected, ["C123"]);
    await run("D:\\ArchiveOther\\Child", false);
    await run("D:\\Outside", false);
    const root = await run("D:\\Archive", true);
    assert.deepStrictEqual(root.created, []);
    assert.deepStrictEqual(root.selected, ["L1"]);

    const bootstrapSource = fs.readFileSync(path.join(__dirname, "../bootstrap.js"), "utf8");
    for (const reason of [1, 4, 6, 7]) {
        let removed = 0;
        const fakePlugin = { async removeWindowsFolderMenu() { removed++; }, async shutdown() {} };
        const lifecycle = { APP_SHUTDOWN: 1, ADDON_DISABLE: 4, ADDON_UNINSTALL: 6,
            Zotero: { isWin: true, ZotLink: fakePlugin, getMainWindows: () => [], getMainWindow: () => ({}) },
            Services: { scriptloader: { loadSubScript() { lifecycle.Zotero.ZotLink = fakePlugin; } } } };
        vm.createContext(lifecycle);
        vm.runInContext(bootstrapSource, lifecycle);
        await lifecycle.shutdown({}, reason);
        assert.strictEqual(removed, reason === 4 || reason === 6 ? 1 : 0,
            "Disable/uninstall removes menus; normal exit and upgrade preserve registration");
        if (reason === 6) {
            await lifecycle.uninstall({ rootURI: "jar:file:///test!/" }, 6);
            assert.strictEqual(removed, 2, "Uninstall fallback must clean even after shutdown removed the plugin object");
        }
    }
    console.log("Windows folder routing regressions passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
